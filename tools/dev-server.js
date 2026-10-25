// Servidor local para probar la página y las funciones /api sin Vercel.
//   node tools/dev-server.js           → usa la API real de Zenith (necesita .env con las llaves)
//   node tools/dev-server.js --mock    → simula Zenith (no crea cobros reales)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8080);
const MOCK = process.argv.includes('--mock');

// Cargar .env local si existe (nunca se sube al repositorio).
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

if (MOCK) {
  process.env.ZENITH_PUBLIC_KEY ||= 'mock';
  process.env.ZENITH_SECRET_KEY ||= 'mock';
  process.env.ZENITH_WEBHOOK_SECRET ||= 'mock-webhook';
  const realFetch = globalThis.fetch;
  const created = new Map();
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.zenithworld.com.br')) return realFetch(url, init);
    const send = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/integrations/payment-methods')) {
      return send({ paymentMethods: [
        { code: 'spei', displayName: 'SPEI', category: 'bank', iconUrl: 'https://api.zenithworld.com.br/elements/icons/spei.svg', requiredPayloadFields: ['customerName', 'customerEmail'] },
        { code: 'oxxo', displayName: 'OXXO', category: 'voucher', iconUrl: 'https://api.zenithworld.com.br/elements/icons/oxxo.svg' },
      ] });
    }
    if (u.endsWith('/integrations/checkouts') && init.method === 'POST') {
      const b = JSON.parse(init.body);
      const key = init.headers['Idempotency-Key'];
      if (!created.has(key)) {
        const id = 'checkout_mock_' + randomUUID().slice(0, 8);
        const nextAction = b.paymentMethod === 'oxxo'
          ? { type: 'voucher', code: '9300' + String(Date.now()).slice(-10), instructions: { title: 'Cómo pagar en OXXO', steps: [
              'Copia o guarda la referencia y el código de barras mostrados.', 'Acude a una tienda OXXO participante.',
              'Solicita un pago de servicio OXXO; muestra el código de barras o dicta la referencia y verifica el monto exacto.',
              'Paga en efectivo, conserva el comprobante y espera la confirmación del comercio.'] } }
          : { type: 'bank_transfer', details: { clabe: '646180000000000000', bankName: 'Banco de ejemplo (simulado)', reference: b.referenceId }, instructions: { title: 'Cómo pagar por SPEI', steps: [
              'Abre la aplicación o el sitio web de tu banco.', 'Selecciona una transferencia SPEI.',
              'Copia la CLABE, el beneficiario, la referencia y el monto exactamente como aparecen.',
              'Confirma la transferencia, conserva el comprobante y espera la confirmación del comercio.'] } };
        created.set(key, { checkout: { id, referenceId: b.referenceId, amount: b.amount, currency: 'MXN', status: 'pending' }, payment: { status: 'pending' },
          method: { code: b.paymentMethod, displayName: b.paymentMethod.toUpperCase(), iconUrl: `https://api.zenithworld.com.br/elements/icons/${b.paymentMethod}.svg` }, nextAction });
      }
      return send(created.get(key), 201);
    }
    if (u.includes('/integrations/checkouts/')) return send({ checkout: { status: 'pending' } });
    return send({ code: 'NOT_FOUND' }, 404);
  };
  console.log('Modo simulado: Zenith no recibe ninguna llamada real.');
}

const handlers = {
  '/api/payment-methods': () => import('../api/payment-methods.js'),
  '/api/checkout': () => import('../api/checkout.js'),
  '/api/checkout-status': () => import('../api/checkout-status.js'),
  '/api/webhooks/zenith': () => import('../api/webhooks/zenith.js'),
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.ttf': 'font/ttf', '.woff': 'font/woff', '.webp': 'image/webp', '.pdf': 'application/pdf' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    // Atajo solo en modo simulado: /__mock/pagar?ref=... envía un webhook firmado de pago.
    if (MOCK && url.pathname === '/__mock/pagar') {
      const { getStore } = await import('../api/_lib/store.js');
      const order = await getStore().get(`order:${url.searchParams.get('ref')}`);
      if (!order) { res.writeHead(404).end('pedido no encontrado'); return; }
      const raw = JSON.stringify({ id: randomUUID(), type: 'payment.captured', data: { referenceId: order.referenceId, amount: order.amount, currency: order.currency } });
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac('sha256', process.env.ZENITH_WEBHOOK_SECRET).update(`${ts}.`).update(raw).digest('hex');
      const r = await fetch(`http://localhost:${PORT}/api/webhooks/zenith`, { method: 'POST', body: raw, headers: { 'X-Zenith-Event-Id': randomUUID(), 'X-Zenith-Event-Type': 'payment.captured', 'X-Zenith-Timestamp': ts, 'X-Zenith-Signature': sig } });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(await r.text());
      return;
    }
    if (handlers[url.pathname]) {
      const mod = await handlers[url.pathname]();
      const fn = mod[req.method];
      if (!fn) { res.writeHead(405).end(); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const out = await fn(request);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || /\/(\.env|api|tests|tools)(\/|$)/.test(path)) { res.writeHead(404).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(data);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(err.code === 'ENOENT' ? 'No encontrado' : 'Error');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
