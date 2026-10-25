// Webhook de Zenith: única fuente de verdad para marcar un pedido como pagado.

import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SECONDS = 300;
const EVENT_TTL = 90 * 86400;
const ORDER_TTL = 400 * 86400;
const PAID_EVENTS = new Set(['payment.captured', 'checkout.succeeded']);

/**
 * @param {{ rawBody: string, timestamp: string|null, signature: string|null, secret: string, nowSeconds: number }} p
 */
export function verifySignature({ rawBody, timestamp, signature, secret, nowSeconds }) {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_AGE_SECONDS) return false;
  if (!/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** @param {Headers|Record<string,string>} h @param {string} name */
function header(h, name) {
  if (typeof /** @type {any} */ (h).get === 'function') return /** @type {Headers} */ (h).get(name);
  const k = Object.keys(h).find((x) => x.toLowerCase() === name);
  return k ? /** @type {any} */ (h)[k] : null;
}

/**
 * @param {{
 *   rawBody: string,
 *   headers: Headers|Record<string,string>,
 *   secret: string|undefined,
 *   store: import('./store.js').Store,
 *   nowSeconds?: number,
 *   onPaid?: (order: any) => Promise<void>,
 * }} ctx
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
export async function handleWebhook(ctx) {
  const nowSeconds = ctx.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!ctx.secret) return { status: 500, body: { error: 'webhook_not_configured' } };

  const eventId = header(ctx.headers, 'x-zenith-event-id');
  const ok = verifySignature({
    rawBody: ctx.rawBody,
    timestamp: header(ctx.headers, 'x-zenith-timestamp'),
    signature: header(ctx.headers, 'x-zenith-signature'),
    secret: ctx.secret,
    nowSeconds,
  });
  if (!ok) return { status: 401, body: { error: 'invalid_signature' } };
  if (!eventId) return { status: 400, body: { error: 'missing_event_id' } };

  let evt;
  try { evt = JSON.parse(ctx.rawBody); } catch { return { status: 400, body: { error: 'invalid_json' } }; }

  const eventKey = `evt:${eventId}`;
  if (await ctx.store.get(eventKey)) return { status: 200, body: { ok: true, duplicate: true } };

  const type = evt?.type ?? header(ctx.headers, 'x-zenith-event-type');
  const data = evt?.data ?? {};
  const referenceId = data.referenceId ?? data.checkout?.referenceId;
  let outcome = 'ignored';

  if (typeof referenceId === 'string') {
    const orderKey = `order:${referenceId}`;
    const order = await ctx.store.get(orderKey);
    if (!order) {
      outcome = 'unknown_order';
    } else if (PAID_EVENTS.has(type)) {
      const amount = data.amount ?? data.checkout?.amount;
      const currency = data.currency ?? data.checkout?.currency;
      if (amount !== order.amount || currency !== order.currency) {
        await ctx.store.set(orderKey, { ...order, alert: { type: 'amount_mismatch', eventId, amount, currency } }, { ttlSeconds: ORDER_TTL });
        outcome = 'amount_mismatch';
      } else if (order.paid) {
        outcome = 'already_paid';
      } else {
        const paid = { ...order, paid: true, status: 'paid', paidAt: nowSeconds, paidEventId: eventId, checkoutStatus: 'succeeded' };
        await ctx.store.set(orderKey, paid, { ttlSeconds: ORDER_TTL });
        if (ctx.onPaid) {
          try { await ctx.onPaid(paid); } catch { /* la entrega no debe hacer fallar la confirmación */ }
        }
        outcome = 'paid';
      }
    } else if (type === 'payment.failed' || type === 'payment.pending') {
      if (!order.paid) {
        await ctx.store.set(orderKey, { ...order, lastPaymentEvent: type, checkoutStatus: type === 'payment.failed' ? 'failed' : 'pending' }, { ttlSeconds: ORDER_TTL });
      }
      outcome = 'recorded';
    }
  }

  await ctx.store.set(eventKey, { type, referenceId: referenceId ?? null, outcome, at: nowSeconds }, { ttlSeconds: EVENT_TTL });
  return { status: 200, body: { ok: true, outcome } };
}

/**
 * Avisa a tu automatización (ZapData, Make, etc.) cuando un pedido se paga.
 * Solo se envían datos del pedido, nunca credenciales.
 * @param {any} order
 */
export async function notifyFulfillment(order) {
  const url = process.env.FULFILLMENT_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'order.paid',
      referenceId: order.referenceId,
      amount: order.amount,
      currency: order.currency,
      items: order.items,
      bumps: order.bumps,
      customer: order.customer,
      utm: order.utm,
      paidAt: order.paidAt,
    }),
    signal: AbortSignal.timeout(8000),
  });
}
