// API de Conversões da Meta (servidor). O token vive SÓ na variável META_CAPI_TOKEN do Vercel.
import { createHash } from 'node:crypto';

export const DEFAULT_PIXEL_ID = '1556039792956905';
export const PRODUCT = { name: 'Kit Sementes de Esperança', value: 16.90, currency: 'EUR' };
// Eventos aceites vindos da página (a compra é enviada pela Hotmart).
export const ALLOWED = new Set(['PageView', 'ViewContent', 'InitiateCheckout']);

const sha = (v) => createHash('sha256').update(v).digest('hex');

/** Dados do utilizador: cookies, IP e navegador sem hash; país em SHA-256. */
export function buildUserData(u = {}) {
  const out = { country: [sha('pt')] };
  if (u.ip) out.client_ip_address = u.ip;
  if (u.ua) out.client_user_agent = u.ua;
  if (u.fbp) out.fbp = u.fbp;
  if (u.fbc) out.fbc = u.fbc;
  return out;
}

/** Dados de rastreio que chegam com o pedido do navegador. @param {Request} request @param {any} body */
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
    url: /^https?:\/\//.test(url) ? url : '',
  };
}

/** Valida o pedido da página. Devolve null se for inválido. @param {any} body */
export function parseEvent(body) {
  if (!body || !ALLOWED.has(body.name)) return null;
  if (typeof body.eventId !== 'string' || !/^[\w-]{8,80}$/.test(body.eventId)) return null;
  return { name: body.name, eventId: body.eventId };
}

/**
 * Envia um evento para a Meta. Nunca lança: os erros só ficam no registo.
 * @param {{ name: string, eventId: string, url?: string, time?: number, user: Parameters<typeof buildUserData>[0] }} e
 * @param {{ fetchImpl?: typeof fetch, env?: Record<string, string|undefined> }} [o]
 */
export async function sendMetaEvent(e, o = {}) {
  const env = o.env ?? process.env;
  const token = env.META_CAPI_TOKEN;
  if (!token) return { skipped: true };
  const pixel = env.META_PIXEL_ID || DEFAULT_PIXEL_ID;
  const version = env.META_API_VERSION || 'v21.0';
  const event = {
    event_name: e.name,
    event_time: e.time ?? Math.floor(Date.now() / 1000),
    event_id: e.eventId,
    action_source: 'website',
    user_data: buildUserData(e.user),
  };
  if (e.url) event.event_source_url = e.url;
  if (e.name !== 'PageView') {
    event.custom_data = { value: PRODUCT.value, currency: PRODUCT.currency, content_name: PRODUCT.name, content_type: 'product' };
  }
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
