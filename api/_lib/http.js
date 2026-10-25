// Utilidades HTTP para las funciones de Vercel (firma Web estándar).

/** @param {unknown} body @param {number} [status] */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** URL pública del sitio para returnUrl/cancelUrl. */
export function siteUrl(request) {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}
