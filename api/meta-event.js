import { json } from './_lib/http.js';
import { sendMetaEvent, trackingFrom } from './_lib/meta.js';
import { PRODUCT } from './_lib/pricing.js';

// POST /api/meta-event → copia de servidor para eventos de navegación (deduplicados por eventId).
// Solo se aceptan eventos sin dinero real: las compras salen únicamente del webhook.
const ALLOWED = new Set(['ViewContent', 'InitiateCheckout']);

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false }, 400); }
  if (!ALLOWED.has(body?.name) || typeof body.eventId !== 'string' || !/^[\w-]{8,80}$/.test(body.eventId)) {
    return json({ ok: false }, 400);
  }
  const t = trackingFrom(request, body);
  await sendMetaEvent({
    name: body.name,
    eventId: body.eventId,
    url: t.url,
    value: PRODUCT.amount / 100,
    currency: 'MXN',
    user: { ip: t.ip, ua: t.ua, fbp: t.fbp, fbc: t.fbc },
  });
  return json({ ok: true });
}
