import { listMethods } from './_lib/checkout-service.js';
import { json } from './_lib/http.js';
import { priceOrder, BUMPS, PRODUCT, CURRENCY } from './_lib/pricing.js';
import { createZenithClient, shapeOf } from './_lib/zenith.js';

// GET /api/payment-methods → formas de pago disponibles ahora + precios de la oferta.
export async function GET(request) {
  try {
    const zenith = createZenithClient();
    // ?estructura=1 → muestra solo nombres de campos y tipos de la respuesta de Zenith (sin valores).
    if (request && new URL(request.url).searchParams.get('estructura') === '1') {
      return json({ shape: shapeOf(await zenith.rawPaymentMethods({ country: 'MX', currency: 'MXN' })) });
    }
    const methods = await listMethods(zenith);
    return json({
      methods,
      currency: CURRENCY,
      product: PRODUCT,
      bumps: Object.values(BUMPS),
      baseAmount: priceOrder([]).amount,
    });
  } catch (err) {
    console.error('payment-methods', err?.code ?? err?.name, err?.status ?? '');
    // El código ayuda a diagnosticar (p. ej. ZENITH_NOT_CONFIGURED, HTTP_401) sin exponer datos sensibles.
    return json({ error: 'No pudimos cargar las formas de pago. Intenta en unos segundos.', code: err?.code ?? 'UNKNOWN', status: err?.status ?? null }, 503);
  }
}
