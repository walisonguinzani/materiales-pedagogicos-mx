import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent, sendMetaEvent, trackingFrom } from '../api/_lib/capi.js';
import { POST } from '../api/meta-event.js';

test('só aceita eventos da página com event_id válido', () => {
  assert.deepEqual(parseEvent({ name: 'PageView', eventId: 'pageview_abc12345' }), { name: 'PageView', eventId: 'pageview_abc12345' });
  assert.equal(parseEvent({ name: 'Purchase', eventId: 'purchase_abc12345' }), null);
  assert.equal(parseEvent({ name: 'ViewContent', eventId: 'x' }), null);
});

test('sem token não chama a Meta', async () => {
  let called = false;
  const r = await sendMetaEvent({ name: 'PageView', eventId: 'pageview_abc12345', user: {} }, { env: {}, fetchImpl: async () => { called = true; } });
  assert.equal(r.skipped, true);
  assert.equal(called, false);
});

test('com token envia para o píxel certo, com o mesmo event_id e valor em EUR', async () => {
  let url, body;
  const fetchImpl = async (u, init) => { url = u; body = JSON.parse(init.body); return new Response('{}', { status: 200 }); };
  await sendMetaEvent({ name: 'InitiateCheckout', eventId: 'initiatecheckout_abc12345', url: 'https://x.pt/', user: { ip: '1.2.3.4', ua: 'UA', fbp: 'fb.1.1.1' } },
    { env: { META_CAPI_TOKEN: 'tok', META_TEST_EVENT_CODE: 'TEST1' }, fetchImpl });
  assert.match(url, /\/1556039792956905\/events\?access_token=tok$/);
  const e = body.data[0];
  assert.equal(e.event_name, 'InitiateCheckout');
  assert.equal(e.event_id, 'initiatecheckout_abc12345');
  assert.deepEqual([e.custom_data.value, e.custom_data.currency], [16.9, 'EUR']);
  assert.equal(e.user_data.client_ip_address, '1.2.3.4');
  assert.equal(body.test_event_code, 'TEST1');
});

test('PageView vai sem valor', async () => {
  let body;
  await sendMetaEvent({ name: 'PageView', eventId: 'pageview_abc12345', user: {} },
    { env: { META_CAPI_TOKEN: 'tok' }, fetchImpl: async (u, init) => { body = JSON.parse(init.body); return new Response('{}'); } });
  assert.equal(body.data[0].custom_data, undefined);
});

test('cookies mal formados são ignorados', () => {
  const req = new Request('https://x.pt/api/meta-event', { headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1', 'user-agent': 'UA' } });
  const t = trackingFrom(req, { fbp: 'lixo', fbc: 'fb.1.123.abc', pageUrl: 'https://x.pt/?a=1' });
  assert.deepEqual(t, { ip: '9.9.9.9', ua: 'UA', fbp: '', fbc: 'fb.1.123.abc', url: 'https://x.pt/?a=1' });
});

test('o endpoint recusa eventos de compra', async () => {
  const r = await POST(new Request('https://x.pt/api/meta-event', { method: 'POST', body: JSON.stringify({ name: 'Purchase', eventId: 'purchase_abc12345' }) }));
  assert.equal(r.status, 400);
});
