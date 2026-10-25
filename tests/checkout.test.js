import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createZenithClient, ZenithError, findMethodList } from '../api/_lib/zenith.js';
import { createMemoryStore } from '../api/_lib/store.js';
import { createOrderCheckout, getOrderStatus, CheckoutError } from '../api/_lib/checkout-service.js';
import { handleWebhook, verifySignature } from '../api/_lib/webhook.js';
import { priceOrder, ALLOWED_METHODS } from '../api/_lib/pricing.js';
import { listMethods } from '../api/_lib/checkout-service.js';
import { nameError, emailError } from '../api/_lib/validate.js';

const CATALOG = { paymentMethods: [
  { code: 'oxxo', displayName: 'OXXO', category: 'voucher', iconUrl: 'https://api.zenithworld.com.br/elements/icons/oxxo.svg' },
  { code: 'spei', displayName: 'SPEI', category: 'bank', requiredPayloadFields: ['metadata.documentNumber', 'metadata.birthDate', 'metadata.birthCountry'] },
] };

/** fetch falso que registra llamadas y responde según `handler`. */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const work = Promise.resolve(handler(url, init, calls.length));
    const r = init.signal
      ? await Promise.race([work, new Promise((_, rej) => {
          if (init.signal.aborted) rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })])
      : await work;
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status ?? 200 });
  };
  fn.calls = calls;
  return fn;
}

function okCheckout(body) {
  return {
    status: 201,
    body: {
      checkout: { id: 'checkout_1', referenceId: body.referenceId, amount: body.amount, currency: 'MXN', status: 'pending' },
      payment: { status: 'pending' },
      method: { code: body.paymentMethod, displayName: 'OXXO', iconUrl: 'https://api.zenithworld.com.br/elements/icons/oxxo.svg' },
      nextAction: { type: 'voucher', code: '92500012345678', instructions: { title: 'Cómo pagar en OXXO', steps: ['Paso 1', 'Paso 2'] }, internal: 'x' },
    },
  };
}

function setup(checkoutHandler, opts = {}) {
  const fetchImpl = fakeFetch(async (url, init, n) => {
    if (url.includes('/integrations/payment-methods')) return { body: CATALOG };
    if (url.endsWith('/integrations/checkouts') && init.method === 'POST') return checkoutHandler(JSON.parse(init.body), init, n);
    if (url.includes('/integrations/checkouts/')) return { body: { checkout: { status: 'pending' } } };
    return { status: 404, body: {} };
  });
  const zenith = createZenithClient({ publicKey: 'pk', secretKey: 'sk', fetchImpl, timeoutMs: opts.timeoutMs ?? 2000 });
  const store = createMemoryStore();
  return { fetchImpl, zenith, store };
}

const buyer = (extra = {}) => ({
  requestId: randomUUID(),
  customerName: 'María Fernanda López',
  customerEmail: 'maria.lopez@gmail.com',
  paymentMethod: 'oxxo',
  bumps: [],
  ...extra,
});

test('solo se ofrece SPEI aunque Zenith libere OXXO', async () => {
  const { zenith } = setup(() => ({}));
  assert.deepEqual((await listMethods(zenith)).map((m) => m.code), ['spei']);
});
// El resto de las pruebas usa OXXO como método genérico de prueba.
test('habilitar oxxo solo para las pruebas', () => { ALLOWED_METHODS.push('oxxo'); });

const checkoutCalls = (f) => f.calls.filter((c) => c.url.endsWith('/integrations/checkouts'));

test('precio único $150 MXN: ids enviados por el navegador no cambian el monto', () => {
  assert.equal(priceOrder([]).amount, 15000);
  assert.equal(priceOrder(['grupo-vip', 'inventado']).amount, 15000);
  assert.deepEqual(priceOrder(['grupo-vip']).bumps, []);
});

test('validación de nombre y correo', () => {
  assert.equal(nameError('María López'), null);
  assert.ok(nameError('María'));
  assert.ok(nameError('M. L.'));
  assert.ok(nameError('Aaaa Bbbb'));
  assert.ok(nameError('Juan 123'));
  assert.equal(emailError('maria@gmail.com'), null);
  assert.ok(emailError('maria@mailinator.com'));
  assert.ok(emailError('maria@'));
});

test('éxito: crea checkout con payload correcto y devuelve solo datos públicos', async () => {
  const { fetchImpl, zenith, store } = setup((b) => okCheckout(b));
  const out = await createOrderCheckout({ body: buyer(), siteUrl: 'https://tienda.mx', zenith, store });
  const [call] = checkoutCalls(fetchImpl);
  assert.equal(call.body.amount, 15000);
  assert.equal(call.body.currency, 'MXN');
  assert.equal(call.body.country, 'MX');
  assert.equal(call.body.environment, 'production');
  assert.equal(call.body.paymentMethod, 'oxxo');
  assert.match(call.body.returnUrl, /^https:\/\/tienda\.mx\/gracias\.html\?ref=/);
  assert.equal(call.body.cancelUrl, 'https://tienda.mx/checkout.html');
  assert.ok(call.init.headers['Idempotency-Key']);
  assert.equal(call.init.headers['X-API-Secret'], 'sk');
  assert.equal(out.amount, 15000);
  assert.equal(out.nextAction.type, 'voucher');
  assert.equal(out.nextAction.code, '92500012345678');
  assert.equal(out.nextAction.internal, undefined);
  assert.equal(JSON.stringify(out).includes('sk'), false);
});

test('método fuera del catálogo se rechaza sin llamar a crear', async () => {
  const { fetchImpl, zenith, store } = setup((b) => okCheckout(b));
  await assert.rejects(createOrderCheckout({ body: buyer({ paymentMethod: 'tarjeta' }), siteUrl: 'https://x.mx', zenith, store }),
    (e) => e instanceof CheckoutError && e.code === 'PAYMENT_METHOD_UNAVAILABLE');
  assert.equal(checkoutCalls(fetchImpl).length, 0);
});

test('falla 422 de Zenith: mensaje en español y la intención queda cerrada', async () => {
  const { fetchImpl, zenith, store } = setup(() => ({ status: 422, body: { code: 'CUSTOMER_NAME_INVALID', message: 'invalid' } }));
  const body = buyer();
  await assert.rejects(createOrderCheckout({ body, siteUrl: 'https://x.mx', zenith, store }),
    (e) => e.status === 422 && /nombre/i.test(e.message) && e.extra.newRequest === true);
  // El mismo requestId no vuelve a llamar a Zenith.
  await assert.rejects(createOrderCheckout({ body, siteUrl: 'https://x.mx', zenith, store }), (e) => e.status === 422);
  assert.equal(checkoutCalls(fetchImpl).length, 1);
});

test('timeout: resultado incierto, reintento usa la MISMA llave y el MISMO payload', async () => {
  let n = 0;
  const { fetchImpl, zenith, store } = setup(async (b) => {
    n += 1;
    if (n === 1) { await new Promise((r) => setTimeout(r, 200)); return okCheckout(b); }
    return okCheckout(b);
  }, { timeoutMs: 50 });
  const body = buyer();
  await assert.rejects(createOrderCheckout({ body, siteUrl: 'https://x.mx', zenith, store }), (e) => e.status === 503 && e.extra.retry === true);
  const out = await createOrderCheckout({ body, siteUrl: 'https://x.mx', zenith, store });
  const calls = checkoutCalls(fetchImpl);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers['Idempotency-Key'], calls[1].init.headers['Idempotency-Key']);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(out.nextAction.type, 'voucher');
});

test('5xx también es incierto y se reintenta con la misma llave', async () => {
  let n = 0;
  const { fetchImpl, zenith, store } = setup((b) => (++n === 1 ? { status: 502, body: {} } : okCheckout(b)));
  const body = buyer();
  await assert.rejects(createOrderCheckout({ body, siteUrl: 'https://x.mx', zenith, store }), (e) => e.status === 503);
  await createOrderCheckout({ body, siteUrl: 'https://x.mx', zenith, store });
  const calls = checkoutCalls(fetchImpl);
  assert.equal(calls[0].init.headers['Idempotency-Key'], calls[1].init.headers['Idempotency-Key']);
});

test('reintento después de éxito no crea otro checkout', async () => {
  const { fetchImpl, zenith, store } = setup((b) => okCheckout(b));
  const body = buyer();
  const a = await createOrderCheckout({ body, siteUrl: 'https://x.mx', zenith, store });
  const b = await createOrderCheckout({ body, siteUrl: 'https://x.mx', zenith, store });
  assert.equal(checkoutCalls(fetchImpl).length, 1);
  assert.equal(a.referenceId, b.referenceId);
});

test('mismo requestId con otro pedido se rechaza (exige nueva intención)', async () => {
  const { zenith, store } = setup((b) => okCheckout(b));
  const body = buyer();
  await createOrderCheckout({ body, siteUrl: 'https://x.mx', zenith, store });
  await assert.rejects(createOrderCheckout({ body: { ...body, customerEmail: 'otra.persona@gmail.com' }, siteUrl: 'https://x.mx', zenith, store }),
    (e) => e.status === 409 && e.extra.newRequest === true);
});

test('respuesta con monto distinto no se acepta', async () => {
  const { zenith, store } = setup((b) => { const r = okCheckout(b); r.body.checkout.amount = 1; return r; });
  await assert.rejects(createOrderCheckout({ body: buyer(), siteUrl: 'https://x.mx', zenith, store }), (e) => e.code === 'CHECKOUT_MISMATCH');
});

test('sin credenciales no se llama a Zenith', async () => {
  const fetchImpl = fakeFetch(() => ({ body: {} }));
  const zenith = createZenithClient({ publicKey: '', secretKey: '', fetchImpl });
  await assert.rejects(zenith.listPaymentMethods({ country: 'MX', currency: 'MXN' }), (e) => e instanceof ZenithError && e.code === 'ZENITH_NOT_CONFIGURED');
  assert.equal(fetchImpl.calls.length, 0);
});

// ---------------- Webhook ----------------
const SECRET = 'whsec_prueba';
function signed(payload, { ts = Math.floor(Date.now() / 1000), eventId = randomUUID(), secret = SECRET } = {}) {
  const rawBody = JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(`${ts}.`).update(rawBody).digest('hex');
  return { rawBody, headers: { 'X-Zenith-Event-Id': eventId, 'X-Zenith-Event-Type': payload.type, 'X-Zenith-Timestamp': String(ts), 'X-Zenith-Signature': sig }, ts };
}

async function paidOrderFixture() {
  const { zenith, store } = setup((b) => okCheckout(b));
  const out = await createOrderCheckout({ body: buyer(), siteUrl: 'https://x.mx', zenith, store });
  return { zenith, store, out };
}

test('webhook válido marca pagado una sola vez y libera acceso', async () => {
  const { zenith, store, out } = await paidOrderFixture();
  let deliveries = 0;
  const evt = signed({ type: 'payment.captured', data: { referenceId: out.referenceId, amount: 15000, currency: 'MXN' } });
  const r1 = await handleWebhook({ ...evt, secret: SECRET, store, nowSeconds: evt.ts, onPaid: async () => { deliveries++; } });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.outcome, 'paid');
  // Webhook repetido (mismo X-Zenith-Event-Id): no se procesa de nuevo.
  const r2 = await handleWebhook({ ...evt, secret: SECRET, store, nowSeconds: evt.ts, onPaid: async () => { deliveries++; } });
  assert.equal(r2.body.duplicate, true);
  // Otro evento de pago para el mismo pedido tampoco duplica la entrega.
  const evt2 = signed({ type: 'checkout.succeeded', data: { referenceId: out.referenceId, amount: 15000, currency: 'MXN' } });
  const r3 = await handleWebhook({ ...evt2, secret: SECRET, store, nowSeconds: evt2.ts, onPaid: async () => { deliveries++; } });
  assert.equal(r3.body.outcome, 'already_paid');
  assert.equal(deliveries, 1);

  const st = await getOrderStatus({ referenceId: out.referenceId, token: out.accessToken, zenith, store, env: { VIP_GROUP_URL: 'https://chat.whatsapp.com/x' } });
  assert.equal(st.status, 'paid');
  assert.equal(st.access.materialUrl, undefined);
  assert.equal(st.access.vipUrl, 'https://chat.whatsapp.com/x');
  // Sin variable de entorno se usa el enlace del grupo que está en el código.
  const st2 = await getOrderStatus({ referenceId: out.referenceId, token: out.accessToken, zenith, store, env: {} });
  assert.match(st2.access.vipUrl, /^https:\/\/chat\.whatsapp\.com\//);
});

test('webhook con firma inválida se rechaza', async () => {
  const { store, out } = await paidOrderFixture();
  const evt = signed({ type: 'payment.captured', data: { referenceId: out.referenceId, amount: 15000, currency: 'MXN' } }, { secret: 'otra' });
  const r = await handleWebhook({ ...evt, secret: SECRET, store, nowSeconds: evt.ts });
  assert.equal(r.status, 401);
  assert.equal((await store.get(`order:${out.referenceId}`)).paid, false);
});

test('webhook con más de 300 s se rechaza', async () => {
  const { store, out } = await paidOrderFixture();
  const evt = signed({ type: 'payment.captured', data: { referenceId: out.referenceId, amount: 15000, currency: 'MXN' } });
  const r = await handleWebhook({ ...evt, secret: SECRET, store, nowSeconds: evt.ts + 301 });
  assert.equal(r.status, 401);
});

test('webhook con monto distinto no libera el pedido', async () => {
  const { store, out } = await paidOrderFixture();
  const evt = signed({ type: 'payment.captured', data: { referenceId: out.referenceId, amount: 100, currency: 'MXN' } });
  const r = await handleWebhook({ ...evt, secret: SECRET, store, nowSeconds: evt.ts });
  assert.equal(r.body.outcome, 'amount_mismatch');
  assert.equal((await store.get(`order:${out.referenceId}`)).paid, false);
});

test('el estado de Zenith "succeeded" sin webhook no libera acceso', async () => {
  const { store, out } = await paidOrderFixture();
  const zenith = { getCheckout: async () => ({ checkout: { status: 'succeeded' } }) };
  const st = await getOrderStatus({ referenceId: out.referenceId, token: out.accessToken, zenith, store, env: {} });
  assert.equal(st.status, 'confirming');
  assert.equal(st.access, undefined);
});

test('token incorrecto no muestra el pedido', async () => {
  const { zenith, store, out } = await paidOrderFixture();
  await assert.rejects(getOrderStatus({ referenceId: out.referenceId, token: 'x', zenith, store }), (e) => e.status === 404);
});

test('verifySignature rechaza firmas mal formadas', () => {
  assert.equal(verifySignature({ rawBody: '{}', timestamp: '1', signature: 'zz', secret: 's', nowSeconds: 1 }), false);
  assert.equal(verifySignature({ rawBody: '{}', timestamp: null, signature: 'aa', secret: 's', nowSeconds: 1 }), false);
});

test('SPEI exige RFC, nacimiento y país, y los envía en metadata', async () => {
  const { fetchImpl, zenith, store } = setup((b) => okCheckout(b));
  await assert.rejects(createOrderCheckout({ body: buyer({ paymentMethod: 'spei' }), siteUrl: 'https://x.mx', zenith, store }),
    (e) => e.status === 422 && e.extra.field === 'documentNumber');
  await assert.rejects(createOrderCheckout({ body: buyer({ paymentMethod: 'spei', documentNumber: 'XAXX010101000', birthDate: '1990-01-15', birthCountry: 'MX' }), siteUrl: 'https://x.mx', zenith, store }),
    (e) => e.extra.field === 'documentNumber');
  await assert.rejects(createOrderCheckout({ body: buyer({ paymentMethod: 'spei', documentNumber: 'LOMF900115AB1', birthDate: '2015-01-01', birthCountry: 'MX' }), siteUrl: 'https://x.mx', zenith, store }),
    (e) => e.extra.field === 'birthDate');
  await createOrderCheckout({ body: buyer({ paymentMethod: 'spei', documentNumber: 'lomf-900115-ab1', birthDate: '1990-01-15', birthCountry: 'mx' }), siteUrl: 'https://x.mx', zenith, store });
  const [call] = checkoutCalls(fetchImpl);
  assert.equal(call.body.paymentMethod, 'spei');
  assert.equal(call.body.metadata.firstName, 'María');
  assert.equal(call.body.metadata.lastName, 'Fernanda López');
});

test('SPEI usa nombre y apellidos tal como los escribió el comprador', async () => {
  const { fetchImpl, zenith, store } = setup((b) => okCheckout(b));
  await createOrderCheckout({ body: buyer({ paymentMethod: 'spei', firstName: 'María Fernanda', lastName: 'López', documentNumber: 'LOMF900115AB1', birthDate: '1990-01-15', birthCountry: 'MX' }), siteUrl: 'https://x.mx', zenith, store });
  const [call] = checkoutCalls(fetchImpl);
  assert.equal(call.body.metadata.firstName, 'María Fernanda');
  assert.equal(call.body.metadata.lastName, 'López');
  assert.equal(call.body.metadata.documentType, 'rfc');
  assert.equal(call.body.metadata.documentNumber, 'LOMF900115AB1');
  assert.equal(call.body.metadata.birthDate, '1990-01-15');
  assert.equal(call.body.metadata.birthCountry, 'MX');
});

test('OXXO no pide ni envía datos de SPEI', async () => {
  const { fetchImpl, zenith, store } = setup((b) => okCheckout(b));
  await createOrderCheckout({ body: buyer(), siteUrl: 'https://x.mx', zenith, store });
  const [call] = checkoutCalls(fetchImpl);
  assert.equal(call.body.metadata.documentNumber, undefined);
});

test('si el catálogo no pide RFC, SPEI se crea solo con nombre y correo', async () => {
  const fetchImpl = fakeFetch(async (url, init) => {
    if (url.includes('/integrations/payment-methods')) return { body: { paymentMethods: [{ code: 'spei', displayName: 'SPEI', category: 'bank', requiredPayloadFields: ['customerName', 'customerEmail'] }] } };
    if (url.endsWith('/integrations/checkouts')) return okCheckout(JSON.parse(init.body));
    return { body: {} };
  });
  const zenith = createZenithClient({ publicKey: 'pk', secretKey: 'sk', fetchImpl });
  const store = createMemoryStore();
  await createOrderCheckout({ body: buyer({ paymentMethod: 'spei' }), siteUrl: 'https://x.mx', zenith, store });
  const [call] = checkoutCalls(fetchImpl);
  assert.equal(call.body.metadata.documentNumber, undefined);
});

test('lee la lista de métodos en distintos formatos de respuesta', () => {
  const m = [{ code: 'oxxo' }, { code: 'spei' }];
  assert.equal(findMethodList(m).length, 2);
  assert.equal(findMethodList({ paymentMethods: m }).length, 2);
  assert.equal(findMethodList({ data: { methods: m } }).length, 2);
  assert.equal(findMethodList({ data: { items: [{ paymentMethod: 'spei', displayName: 'SPEI' }] } })[0].paymentMethod, 'spei');
  assert.deepEqual(findMethodList({ methods: { oxxo: { displayName: 'OXXO' }, spei: { displayName: 'SPEI' } } }).map((x) => x.code), ['oxxo', 'spei']);
  assert.deepEqual(findMethodList({ country: 'MX', methods: ['oxxo', 'spei'] }).map((x) => x.code), ['oxxo', 'spei']);
  assert.equal(findMethodList({ ok: true }).length, 0);
});

import { buildUserData, normalizePhone, sendMetaEvent } from '../api/_lib/meta.js';

test('Meta: teléfono MX normalizado y datos personales en SHA-256', () => {
  assert.equal(normalizePhone('55 1234 5678'), '525512345678');
  assert.equal(normalizePhone('+52 1 55 1234 5678'), '525512345678');
  assert.equal(normalizePhone('123'), '');
  const u = buildUserData({ email: ' Maria@Gmail.com ', phone: '5512345678', firstName: 'María', lastName: 'López', externalId: 'cal-1', ip: '1.2.3.4', ua: 'UA', fbp: 'fb.1.1.1', fbc: 'fb.1.1.abc' });
  assert.match(u.em[0], /^[0-9a-f]{64}$/);
  assert.notEqual(u.em[0], 'maria@gmail.com');
  assert.equal(u.client_ip_address, '1.2.3.4');
  assert.equal(u.fbp, 'fb.1.1.1');
});

test('Meta: sin token no se envía nada; con token usa el event_id dado', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}'); };
  assert.equal((await sendMetaEvent({ name: 'Purchase', eventId: 'purchase_x', user: {} }, { fetchImpl, env: {} })).skipped, true);
  await sendMetaEvent({ name: 'Purchase', eventId: 'purchase_x', value: 250, user: { email: 'a@b.mx' } }, { fetchImpl, env: { META_CAPI_TOKEN: 't', META_PIXEL_ID: '123' } });
  assert.match(calls[0].url, /\/123\/events\?access_token=t$/);
  assert.equal(calls[0].body.data[0].event_id, 'purchase_x');
  assert.equal(calls[0].body.data[0].custom_data.value, 250);
  assert.equal(calls[0].body.data[0].custom_data.currency, 'MXN');
});

test('checkout dispara AddPaymentInfo una sola vez y guarda rastreo para la compra', async () => {
  const { zenith, store } = setup((b) => okCheckout(b));
  let n = 0;
  const body = buyer({ customerPhone: '55 1234 5678' });
  const tracking = { ip: '1.2.3.4', ua: 'UA', fbp: 'fb.1.1.1', fbc: '', url: 'https://x.mx/checkout.html' };
  const out = await createOrderCheckout({ body, siteUrl: 'https://x.mx', zenith, store, tracking, onPaymentGenerated: async () => { n++; } });
  await createOrderCheckout({ body, siteUrl: 'https://x.mx', zenith, store, tracking, onPaymentGenerated: async () => { n++; } });
  assert.equal(n, 1);
  const order = await store.get(`order:${out.referenceId}`);
  assert.equal(order.customer.phone, '525512345678');
  assert.equal(order.tracking.fbp, 'fb.1.1.1');
});
