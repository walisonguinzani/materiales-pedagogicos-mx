// API de Conversiones de Meta (servidor). El token vive SOLO en META_CAPI_TOKEN.
import { createHash } from 'node:crypto';

// Sin píxel por defecto: configura META_PIXEL_ID con el píxel de esta oferta.
export const DEFAULT_PIXEL_ID = '';
const sha = (v) => createHash('sha256').update(v).digest('hex');

/** Normaliza teléfono MX a dígitos con código de país 52. @param {unknown} v */
export function normalizePhone(v) {
  if (typeof v !== 'string') return '';
  let d = v.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10) d = '52' + d;
  if (d.startsWith('521') && d.length === 13) d = '52' + d.slice(3); // formato móvil antiguo
  return d.length >= 11 && d.length <= 15 ? d : '';
}

const norm = (v) => (typeof v === 'string' ? v.normalize('NFC').trim().toLowerCase() : '');

/**
 * Arma user_data: datos personales en SHA-256, cookies/IP/UA sin hash.
 * @param {{ email?: string, phone?: string, firstName?: string, lastName?: string, externalId?: string,
 *   ip?: string, ua?: string, fbp?: string, fbc?: string }} u
 */
export function buildUserData(u = {}) {
  const out = { country: [sha('mx')] };
  if (norm(u.email)) out.em = [sha(norm(u.email))];
  const ph = normalizePhone(u.phone);
  if (ph) out.ph = [sha(ph)];
  if (norm(u.firstName)) out.fn = [sha(norm(u.firstName))];
  if (norm(u.lastName)) out.ln = [sha(norm(u.lastName))];
  if (u.externalId) out.external_id = [sha(String(u.externalId))];
  if (u.ip) out.client_ip_address = u.ip;
  if (u.ua) out.client_user_agent = u.ua;
  if (u.fbp) out.fbp = u.fbp;
  if (u.fbc) out.fbc = u.fbc;
  return out;
}

/** Datos de rastreo del navegador que llegan con la petición. @param {Request} request @param {any} body */
export function trackingFrom(request, body = {}) {
  const h = request.headers;
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || '';
  const clean = (v, max = 300) => (typeof v === 'string' && v.length <= max ? v : '');
  const url = clean(body.pageUrl, 1000);
  return {
    ip,
    ua: (h.get('user-agent') || '').slice(0, 500),
    fbp: /^fb\.\d\.\d+\.\d+$/.test(clean(body.fbp)) ? body.fbp : '',
    fbc: /^fb\.\d\.\d+\.[\w-]+$/.test(clean(body.fbc)) ? body.fbc : '',
    url: /^https:\/\//.test(url) ? url : '',
  };
}

/**
 * Envía un evento a Meta. Nunca lanza: los errores solo se registran.
 * @param {{ name: string, eventId: string, url?: string, time?: number, value?: number, currency?: string, user: Parameters<typeof buildUserData>[0] }} e
 * @param {{ fetchImpl?: typeof fetch, env?: Record<string, string|undefined> }} [o]
 */
export async function sendMetaEvent(e, o = {}) {
  const env = o.env ?? process.env;
  const token = env.META_CAPI_TOKEN;
  if (!token) return { skipped: true };
  const pixel = env.META_PIXEL_ID || DEFAULT_PIXEL_ID;
  if (!pixel) return { skipped: true };
  const version = env.META_API_VERSION || 'v21.0';
  const event = {
    event_name: e.name,
    event_time: e.time ?? Math.floor(Date.now() / 1000),
    event_id: e.eventId,
    action_source: 'website',
    user_data: buildUserData(e.user),
  };
  if (e.url) event.event_source_url = e.url;
  if (typeof e.value === 'number') event.custom_data = { value: Number(e.value.toFixed(2)), currency: e.currency || 'MXN', content_name: 'Kit Semillas de Esperanza', content_type: 'product' };
  const payload = { data: [event] };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;
  try {
    const res = await (o.fetchImpl ?? fetch)(`https://graph.facebook.com/${version}/${pixel}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.warn('meta capi', e.name, res.status);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.warn('meta capi', e.name, err?.name);
    return { ok: false };
  }
}

/** Eventos con id determinístico por pedido, para deduplicar navegador + servidor. */
export const eventIds = {
  paymentInfo: (ref) => `api_${ref}`,
  purchase: (ref) => `purchase_${ref}`,
};

/** @param {any} order */
export function orderUser(order) {
  return {
    email: order.customer?.email,
    phone: order.customer?.phone,
    firstName: order.customer?.firstName,
    lastName: order.customer?.lastName,
    externalId: order.referenceId,
    ip: order.tracking?.ip,
    ua: order.tracking?.ua,
    fbp: order.tracking?.fbp,
    fbc: order.tracking?.fbc,
  };
}
