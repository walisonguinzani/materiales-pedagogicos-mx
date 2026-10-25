import { CheckoutError, getOrderStatus } from './_lib/checkout-service.js';
import { json } from './_lib/http.js';
import { getStore } from './_lib/store.js';
import { createZenithClient } from './_lib/zenith.js';

// GET /api/checkout-status?ref=...&t=... → estado del pedido para la pantalla del comprador.
export async function GET(request) {
  const u = new URL(request.url);
  const referenceId = u.searchParams.get('ref') ?? '';
  const token = u.searchParams.get('t') ?? '';
  if (!referenceId || !token) return json({ error: 'Faltan datos del pedido.' }, 400);
  try {
    const out = await getOrderStatus({ referenceId, token, zenith: createZenithClient(), store: getStore() });
    return json(out);
  } catch (err) {
    if (err instanceof CheckoutError) return json({ error: err.message }, err.status);
    console.error('checkout-status', err?.code ?? err?.name);
    return json({ error: 'No pudimos consultar tu pedido.' }, 500);
  }
}
