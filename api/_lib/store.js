// Persistencia de pedidos, llaves de idempotencia y eventos de webhook.
// Producción: Upstash Redis / Vercel KV vía REST (sin dependencias).
// Desarrollo y pruebas: memoria.

/**
 * @typedef {{
 *   get(key: string): Promise<any|null>,
 *   set(key: string, value: any, opts?: { ttlSeconds?: number }): Promise<void>,
 *   setIfAbsent(key: string, value: any, opts?: { ttlSeconds?: number }): Promise<boolean>,
 * }} Store
 */

/** @returns {Store} */
export function createMemoryStore() {
  const m = new Map();
  return {
    async get(key) { return m.has(key) ? structuredClone(m.get(key)) : null; },
    async set(key, value) { m.set(key, structuredClone(value)); },
    async setIfAbsent(key, value) {
      if (m.has(key)) return false;
      m.set(key, structuredClone(value));
      return true;
    },
  };
}

/**
 * @param {{ url: string, token: string, fetchImpl?: typeof fetch }} cfg
 * @returns {Store}
 */
export function createUpstashStore({ url, token, fetchImpl = globalThis.fetch }) {
  async function cmd(args) {
    const res = await fetchImpl(url.replace(/\/$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Store respondió ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`Store: ${data.error}`);
    return data.result;
  }
  return {
    async get(key) {
      const r = await cmd(['GET', key]);
      return r == null ? null : JSON.parse(r);
    },
    async set(key, value, opts = {}) {
      const args = ['SET', key, JSON.stringify(value)];
      if (opts.ttlSeconds) args.push('EX', String(opts.ttlSeconds));
      await cmd(args);
    },
    async setIfAbsent(key, value, opts = {}) {
      const args = ['SET', key, JSON.stringify(value), 'NX'];
      if (opts.ttlSeconds) args.push('EX', String(opts.ttlSeconds));
      return (await cmd(args)) === 'OK';
    },
  };
}

let shared = null;

/** Store compartido según el entorno. */
export function getStore() {
  if (shared) return shared;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    shared = createUpstashStore({ url, token });
  } else {
    if (process.env.VERCEL_ENV === 'production') {
      throw new Error('Falta configurar la base de datos (KV_REST_API_URL y KV_REST_API_TOKEN).');
    }
    shared = createMemoryStore();
  }
  return shared;
}

/** Solo para pruebas. @param {Store|null} s */
export function setStore(s) { shared = s; }
