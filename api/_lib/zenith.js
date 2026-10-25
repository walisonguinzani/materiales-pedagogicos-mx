// Cliente server-side mínimo para la Zenith Payments API.
// Las credenciales se leen SOLO de variables de entorno del backend.
// Nunca registrar, devolver ni enviar al navegador la secret.

export const ZENITH_BASE_URL = 'https://api.zenithworld.com.br';

export class ZenithError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, uncertain?: boolean, details?: unknown }} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'ZenithError';
    this.status = info.status ?? 0;
    this.code = info.code ?? 'ZENITH_ERROR';
    /** true = no sabemos si Zenith creó el checkout (timeout, red, 5xx) */
    this.uncertain = info.uncertain ?? false;
    this.details = info.details;
  }
}

/**
 * @param {{
 *   publicKey?: string, secretKey?: string, environment?: string,
 *   fetchImpl?: typeof fetch, timeoutMs?: number, baseUrl?: string
 * }} [opts]
 */
export function createZenithClient(opts = {}) {
  const publicKey = opts.publicKey ?? process.env.ZENITH_PUBLIC_KEY;
  const secretKey = opts.secretKey ?? process.env.ZENITH_SECRET_KEY;
  const environment = opts.environment ?? process.env.ZENITH_ENVIRONMENT ?? 'production';
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const baseUrl = opts.baseUrl ?? ZENITH_BASE_URL;

  function assertConfigured() {
    if (!publicKey || !secretKey) {
      throw new ZenithError('Faltan ZENITH_PUBLIC_KEY o ZENITH_SECRET_KEY en el servidor.', { code: 'ZENITH_NOT_CONFIGURED' });
    }
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ body?: unknown, idempotencyKey?: string }} [o]
   */
  async function request(method, path, o = {}) {
    assertConfigured();
    const headers = {
      'X-API-Key': /** @type {string} */ (publicKey),
      'X-API-Secret': /** @type {string} */ (secretKey),
      Accept: 'application/json',
    };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.idempotencyKey) headers['Idempotency-Key'] = o.idempotencyKey;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(baseUrl + path, {
        method,
        headers,
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      const timedOut = err && /** @type {any} */ (err).name === 'AbortError';
      throw new ZenithError(timedOut ? 'Zenith no respondió a tiempo.' : 'No se pudo conectar con Zenith.', {
        code: timedOut ? 'ZENITH_TIMEOUT' : 'ZENITH_NETWORK',
        uncertain: true,
      });
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) {
      const code = (data && (data.code || data.error?.code)) || `HTTP_${res.status}`;
      const message = (data && (data.message || data.error?.message)) || `Zenith respondió ${res.status}.`;
      throw new ZenithError(message, { status: res.status, code, uncertain: res.status >= 500, details: data });
    }
    return data;
  }

  return {
    environment,

    /**
     * Métodos disponibles para la cuenta. Siempre consultar en runtime.
     * @param {{ country: string, currency: string }} q
     */
    async listPaymentMethods(q) {
      const qs = new URLSearchParams({ country: q.country, currency: q.currency, environment });
      const data = await request('GET', `/integrations/payment-methods?${qs}`);
      return findMethodList(data);
    },

    /**
     * Crea el checkout. Reutilizar SIEMPRE la misma idempotencyKey y el mismo payload en reintentos.
     * @param {Record<string, unknown>} payload
     * @param {string} idempotencyKey
     */
    async createCheckout(payload, idempotencyKey) {
      if (!idempotencyKey) throw new ZenithError('Falta Idempotency-Key.', { code: 'IDEMPOTENCY_KEY_REQUIRED' });
      return request('POST', '/integrations/checkouts', { body: { ...payload, environment }, idempotencyKey });
    },

    /** Respuesta cruda del catálogo (solo para diagnóstico de estructura). @param {{ country: string, currency: string }} q */
    async rawPaymentMethods(q) {
      const qs = new URLSearchParams({ country: q.country, currency: q.currency, environment });
      return request('GET', `/integrations/payment-methods?${qs}`);
    },

    /** @param {string} checkoutId */
    async getCheckout(checkoutId) {
      return request('GET', `/integrations/checkouts/${encodeURIComponent(checkoutId)}`);
    },
  };
}

/**
 * Normaliza un método del catálogo a lo que necesita el navegador.
 * @param {any} m
 */
export function publicMethod(m) {
  const code = m?.code ?? m?.paymentMethod ?? m?.methodCode ?? m?.method ?? m?.slug ?? m?.id;
  if (!code || typeof code !== 'string') return null;
  return {
    code,
    displayName: typeof m.displayName === 'string' ? m.displayName : typeof m.name === 'string' ? m.name : code.toUpperCase(),
    category: typeof m.category === 'string' ? m.category : null,
    iconUrl: typeof m.iconUrl === 'string' && m.iconUrl.startsWith('https://') ? m.iconUrl : null,
    amountLimits: m.amountLimits && typeof m.amountLimits === 'object'
      ? { min: Number(m.amountLimits.min ?? m.amountLimits.minimum) || null, max: Number(m.amountLimits.max ?? m.amountLimits.maximum) || null }
      : null,
    requiredPayloadFields: Array.isArray(m.requiredPayloadFields) ? m.requiredPayloadFields.filter((f) => typeof f === 'string') : [],
  };
}

/**
 * Deja solo los campos del nextAction que el comprador necesita.
 * No inventa ni completa nada: lo que no viene, no se muestra.
 * @param {any} na
 */
export function publicNextAction(na) {
  if (!na || typeof na !== 'object' || typeof na.type !== 'string') return null;
  const out = { type: na.type };
  if (typeof na.url === 'string' && na.url.startsWith('https://')) out.url = na.url;
  if (typeof na.code === 'string' || typeof na.code === 'number') out.code = String(na.code);
  if (typeof na.app === 'string') out.app = na.app;
  if (typeof na.paymentPageUrl === 'string' && na.paymentPageUrl.startsWith('https://')) out.paymentPageUrl = na.paymentPageUrl;
  if (na.details && typeof na.details === 'object') {
    out.details = Object.fromEntries(Object.entries(na.details).filter(([, v]) => typeof v === 'string' || typeof v === 'number'));
  }
  if (na.presentation && typeof na.presentation === 'object') {
    const p = {};
    if (typeof na.presentation.expiresAt === 'string') p.expiresAt = na.presentation.expiresAt;
    if (Object.keys(p).length) out.presentation = p;
  }
  if (na.instructions && typeof na.instructions === 'object') {
    out.instructions = {
      title: typeof na.instructions.title === 'string' ? na.instructions.title : null,
      steps: Array.isArray(na.instructions.steps) ? na.instructions.steps.filter((s) => typeof s === 'string') : [],
    };
  }
  return out;
}

const METHOD_KEYS = ['code', 'paymentMethod', 'method', 'methodCode', 'slug', 'id'];
const isMethod = (o) => o && typeof o === 'object' && !Array.isArray(o) && METHOD_KEYS.some((k) => typeof o[k] === 'string');

/**
 * Encuentra la lista de métodos en la respuesta, sin importar cómo venga anidada
 * (array directo, { paymentMethods }, { data: { methods } }, { methods: { oxxo: {...} } }, etc.).
 * @param {unknown} data
 * @returns {any[]}
 */
export function findMethodList(data, depth = 0) {
  if (depth > 5 || data == null) return [];
  if (Array.isArray(data)) {
    if (data.some(isMethod)) return data.filter(isMethod);
    if (data.every((x) => typeof x === 'string')) return data.map((code) => ({ code }));
    for (const x of data) { const r = findMethodList(x, depth + 1); if (r.length) return r; }
    return [];
  }
  if (typeof data !== 'object') return [];
  const preferred = ['paymentMethods', 'methods', 'availableMethods', 'items', 'results', 'data', 'catalog'];
  for (const k of preferred) {
    if (k in data) { const r = findMethodList(data[k], depth + 1); if (r.length) return r; }
  }
  // Objeto indexado por código: { oxxo: {...}, spei: {...} }
  const vals = Object.entries(data).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
  if (vals.length && vals.every(([, v]) => ['displayName', 'name', 'category', 'enabled', 'available', 'requiredPayloadFields'].some((f) => f in v))) {
    return vals.map(([k, v]) => ({ code: k, ...v }));
  }
  for (const v of Object.values(data)) { const r = findMethodList(v, depth + 1); if (r.length) return r; }
  return [];
}

/** Estructura de la respuesta (solo nombres de campos y tipos), para diagnóstico. */
export function shapeOf(v, depth = 0) {
  if (depth > 4) return '…';
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1), `(${v.length})`] : [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 25).map(([k, x]) => [k, shapeOf(x, depth + 1)]));
  return typeof v;
}
