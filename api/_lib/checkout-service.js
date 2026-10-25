// Lógica de creación de checkout, separada de HTTP para poder probarla.

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ALLOWED_METHODS, COUNTRY, CURRENCY, DEFAULT_VIP_GROUP_URL, priceOrder } from './pricing.js';
import { birthDateError, cleanCountry, cleanEmail, cleanName, cleanRfc, emailError, isUuid, nameError, rfcError, splitName } from './validate.js';
import { ZenithError, publicMethod, publicNextAction } from './zenith.js';
import { normalizePhone } from './meta.js';

const DAY = 86400;
const INTENT_TTL = 30 * DAY;
const ORDER_TTL = 400 * DAY;

/** Error con status HTTP y mensaje en español para el comprador. */
export class CheckoutError extends Error {
  /** @param {number} status @param {string} code @param {string} message @param {Record<string, unknown>} [extra] */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const ZENITH_MESSAGES = {
  CUSTOMER_NAME_REQUIRED: 'Escribe tu nombre y apellido.',
  CUSTOMER_NAME_INVALID: 'Revisa tu nombre: escribe tu nombre y apellido reales.',
  CUSTOMER_EMAIL_INVALID: 'Revisa tu correo: usa tu correo real.',
};

/** Huella estable de lo que el comprador pidió, para detectar cambios entre reintentos. */
function fingerprint(o) {
  return JSON.stringify([o.amount, o.currency, o.paymentMethod, o.customerName, o.customerEmail, o.bumps, o.kyc ?? null, o.phone ?? '']);
}

/** Métodos que exigen identificación del pagador (RFC, nacimiento). */
export const KYC_METHODS = new Set(['spei']);

function makeReferenceId(now) {
  return `sem-${now.toString(36)}-${randomUUID().slice(0, 8)}`;
}

/**
 * Métodos que la cuenta tiene disponibles ahora para MX/MXN.
 * @param {ReturnType<import('./zenith.js').createZenithClient>} zenith
 */
export async function listMethods(zenith) {
  const raw = await zenith.listPaymentMethods({ country: COUNTRY, currency: CURRENCY });
  return raw
    .filter((m) => ALLOWED_METHODS.includes(m?.code ?? m?.paymentMethod ?? m?.methodCode ?? m?.method ?? m?.slug ?? m?.id))
    .filter((m) => m.enabled !== false && m.available !== false && m.active !== false && m.status !== 'disabled')
    .map(publicMethod).filter(Boolean);
}

function publicResult(order) {
  return {
    referenceId: order.referenceId,
    accessToken: order.accessToken,
    amount: order.amount,
    currency: order.currency,
    items: order.items,
    status: order.paid ? 'paid' : order.checkoutStatus ?? 'pending',
    method: order.method ?? null,
    nextAction: order.nextAction ?? null,
  };
}

/**
 * @param {{
 *   body: any,
 *   siteUrl: string,
 *   zenith: ReturnType<import('./zenith.js').createZenithClient>,
 *   store: import('./store.js').Store,
 *   now?: () => number,
 *   newId?: () => string,
 * }} ctx
 */
export async function createOrderCheckout(ctx) {
  const { body, siteUrl, zenith, store } = ctx;
  const now = ctx.now ?? Date.now;
  const newId = ctx.newId ?? randomUUID;

  if (!body || typeof body !== 'object') throw new CheckoutError(400, 'BAD_REQUEST', 'Solicitud inválida.');
  const requestId = body.requestId;
  if (!isUuid(requestId)) throw new CheckoutError(400, 'BAD_REQUEST_ID', 'Solicitud inválida. Recarga la página e intenta de nuevo.');

  const customerName = cleanName(body.customerName);
  const customerEmail = cleanEmail(body.customerEmail);
  const errName = nameError(customerName);
  if (errName) throw new CheckoutError(422, 'CUSTOMER_NAME_INVALID', errName, { field: 'customerName' });
  const errEmail = emailError(customerEmail);
  if (errEmail) throw new CheckoutError(422, 'CUSTOMER_EMAIL_INVALID', errEmail, { field: 'customerEmail' });

  const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod : '';
  // Datos de identificación: solo si el catálogo de Zenith los exige para este método.
  let catalog = null;
  try { catalog = (await listMethods(zenith)).find((x) => x.code === paymentMethod) ?? null; } catch { catalog = null; }
  const needsKyc = KYC_METHODS.has(paymentMethod) && (catalog?.requiredPayloadFields ?? []).some((f) => /documentNumber|birthDate|rfc/i.test(f));
  let kyc = null;
  if (needsKyc) {
    const documentNumber = cleanRfc(body.documentNumber);
    const errRfc = rfcError(documentNumber);
    if (errRfc) throw new CheckoutError(422, 'DOCUMENT_INVALID', errRfc, { field: 'documentNumber' });
    const errBirth = birthDateError(body.birthDate);
    if (errBirth) throw new CheckoutError(422, 'BIRTH_DATE_INVALID', errBirth, { field: 'birthDate' });
    const birthCountry = cleanCountry(body.birthCountry);
    if (!birthCountry) throw new CheckoutError(422, 'BIRTH_COUNTRY_INVALID', 'Elige tu país de nacimiento.', { field: 'birthCountry' });
    const fn = cleanName(body.firstName), ln = cleanName(body.lastName);
    const names = fn && ln && `${fn} ${ln}` === customerName ? { firstName: fn, lastName: ln } : splitName(customerName);
    kyc = { ...names, documentType: 'rfc', documentNumber, birthDate: body.birthDate, birthCountry };
  }
  const priced = priceOrder(body.bumps);
  const phone = normalizePhone(body.customerPhone);
  if (typeof body.customerPhone === 'string' && body.customerPhone.trim() && !phone) {
    throw new CheckoutError(422, 'PHONE_INVALID', 'Revisa tu WhatsApp: escribe los 10 dígitos.', { field: 'customerPhone' });
  }
  const core = { amount: priced.amount, currency: CURRENCY, paymentMethod, customerName, customerEmail, bumps: priced.bumps, kyc, phone };
  const names = kyc ? { firstName: kyc.firstName, lastName: kyc.lastName } : (() => {
    const fn = cleanName(body.firstName), ln = cleanName(body.lastName);
    return fn && ln && `${fn} ${ln}` === customerName ? { firstName: fn, lastName: ln } : splitName(customerName);
  })();
  const fp = fingerprint(core);

  const intentKey = `intent:${requestId}`;
  let intent = await store.get(intentKey);

  if (intent) {
    if (intent.fingerprint !== fp) {
      throw new CheckoutError(409, 'REQUEST_CHANGED', 'Cambiaste tu pedido. Intenta de nuevo.', { newRequest: true });
    }
    const order = await store.get(`order:${intent.referenceId}`);
    if (order?.checkoutId) return publicResult(order);
    if (intent.failed) {
      throw new CheckoutError(intent.failed.status, intent.failed.code, intent.failed.message, { newRequest: true });
    }
    // Reintento de una intención sin resultado: misma llave, mismo payload.
  } else {
    // Validar método contra el catálogo vigente antes de crear la intención.
    if (!catalog) {
      let methods;
      try { methods = await listMethods(zenith); } catch {
        throw new CheckoutError(503, 'METHODS_UNAVAILABLE', 'No pudimos cargar las formas de pago. Intenta en unos segundos.', { retry: true });
      }
      catalog = methods.find((x) => x.code === paymentMethod) ?? null;
    }
    const m = catalog;
    if (!m) throw new CheckoutError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Esa forma de pago no está disponible. Elige otra.', { field: 'paymentMethod' });
    if (m.amountLimits?.max && priced.amount > m.amountLimits.max) {
      throw new CheckoutError(422, 'AMOUNT_ABOVE_LIMIT', 'El total supera el límite de esa forma de pago. Elige otra.', { field: 'paymentMethod' });
    }

    const referenceId = makeReferenceId(now());
    const accessToken = newId();
    const base = siteUrl.replace(/\/$/, '');
    const utm = body.utm && typeof body.utm === 'object'
      ? Object.fromEntries(Object.entries(body.utm).filter(([k, v]) => /^(utm_[a-z]+|fbclid|sck|src)$/.test(k) && typeof v === 'string').map(([k, v]) => [k, v.slice(0, 200)]))
      : {};
    const zenithPayload = {
      amount: priced.amount,
      currency: CURRENCY,
      country: COUNTRY,
      paymentMethod,
      referenceId,
      customerName,
      customerEmail,
      returnUrl: `${base}/gracias.html?ref=${encodeURIComponent(referenceId)}&t=${encodeURIComponent(accessToken)}`,
      cancelUrl: `${base}/checkout.html`,
      metadata: { customerName, customerEmail, bumps: priced.bumps.join(',') || 'ninguno', ...(kyc ?? {}) },
    };
    intent = { requestId, referenceId, idempotencyKey: newId(), fingerprint: fp, zenithPayload, createdAt: now() };
    const created = await store.setIfAbsent(intentKey, intent, { ttlSeconds: INTENT_TTL });
    if (!created) {
      // Otra petición con el mismo requestId ganó la carrera: usar la suya.
      intent = await store.get(intentKey);
      if (!intent || intent.fingerprint !== fp) throw new CheckoutError(409, 'REQUEST_CHANGED', 'Intenta de nuevo.', { newRequest: true });
    } else {
      await store.set(`order:${referenceId}`, {
        referenceId,
        accessToken,
        amount: priced.amount,
        currency: CURRENCY,
        items: priced.items,
        bumps: priced.bumps,
        customer: { name: customerName, email: customerEmail, phone, ...names },
        tracking: ctx.tracking ?? null,
        paymentMethod,
        utm,
        paid: false,
        status: 'creating',
        createdAt: now(),
      }, { ttlSeconds: ORDER_TTL });
    }
  }

  const orderKey = `order:${intent.referenceId}`;
  let result;
  try {
    result = await zenith.createCheckout(intent.zenithPayload, intent.idempotencyKey);
  } catch (err) {
    if (err instanceof ZenithError && (err.uncertain || err.status === 429)) {
      const order = await store.get(orderKey);
      if (order) await store.set(orderKey, { ...order, status: 'uncertain', lastError: err.code }, { ttlSeconds: ORDER_TTL });
      throw new CheckoutError(503, 'UNCERTAIN', 'La conexión tardó demasiado. Intentando de nuevo…', { retry: true });
    }
    if (err instanceof ZenithError) {
      const message = ZENITH_MESSAGES[err.code] ?? 'No pudimos generar tu pago. Revisa tus datos o elige otra forma de pago.';
      const status = err.status >= 400 && err.status < 500 ? (err.status === 409 ? 409 : 422) : 502;
      await store.set(intentKey, { ...intent, failed: { status, code: err.code, message } }, { ttlSeconds: INTENT_TTL });
      const order = await store.get(orderKey);
      if (order) await store.set(orderKey, { ...order, status: 'creation_failed', lastError: err.code }, { ttlSeconds: ORDER_TTL });
      throw new CheckoutError(status, err.code, message, { newRequest: true });
    }
    throw err;
  }

  const co = result?.checkout ?? {};
  if (!co.id || co.referenceId !== intent.referenceId || co.amount !== intent.zenithPayload.amount || co.currency !== CURRENCY) {
    const order = await store.get(orderKey);
    if (order) await store.set(orderKey, { ...order, status: 'mismatch' }, { ttlSeconds: ORDER_TTL });
    throw new CheckoutError(502, 'CHECKOUT_MISMATCH', 'No pudimos confirmar los datos de tu pago. Escríbenos para ayudarte.');
  }

  const order = (await store.get(orderKey)) ?? {};
  const updated = {
    ...order,
    checkoutId: co.id,
    checkoutStatus: co.status ?? 'pending',
    status: order.paid ? 'paid' : 'pending',
    method: result.method ? { code: result.method.code, displayName: result.method.displayName, iconUrl: typeof result.method.iconUrl === 'string' && result.method.iconUrl.startsWith('https://') ? result.method.iconUrl : null } : null,
    nextAction: publicNextAction(result.nextAction),
  };
  await store.set(orderKey, updated, { ttlSeconds: ORDER_TTL });
  if (ctx.onPaymentGenerated && !order.checkoutId) {
    try { await ctx.onPaymentGenerated(updated); } catch { /* el rastreo no debe afectar el pago */ }
  }
  return publicResult(updated);
}

/** Compara tokens sin filtrar tiempo. */
export function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Estado del pedido para la pantalla del comprador.
 * El estado de Zenith solo sirve para UX: "pagado" viene únicamente del webhook.
 * @param {{ referenceId: string, token: string, zenith: any, store: import('./store.js').Store, env?: Record<string,string|undefined> }} ctx
 */
export async function getOrderStatus(ctx) {
  const env = ctx.env ?? process.env;
  const order = await ctx.store.get(`order:${ctx.referenceId}`);
  if (!order || !sameToken(order.accessToken, ctx.token)) throw new CheckoutError(404, 'NOT_FOUND', 'No encontramos tu pedido.');

  let uxStatus = order.paid ? 'paid' : order.checkoutStatus ?? 'pending';
  if (!order.paid && order.checkoutId) {
    try {
      const live = await ctx.zenith.getCheckout(order.checkoutId);
      const s = live?.checkout?.status ?? live?.status;
      if (typeof s === 'string') uxStatus = s === 'succeeded' ? 'confirming' : s;
    } catch { /* solo UX: ignorar */ }
  }
  const out = publicResult(order);
  out.status = uxStatus;
  if (order.paid) {
    // Esta oferta no entrega archivos: el acceso es el Grupo VIP de WhatsApp.
    out.access = { vipUrl: env.VIP_GROUP_URL || DEFAULT_VIP_GROUP_URL };
  }
  return out;
}
