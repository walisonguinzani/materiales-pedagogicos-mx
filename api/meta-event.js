import { parseEvent, sendMetaEvent, trackingFrom } from './_lib/capi.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

// POST /api/meta-event → cópia no servidor (API de Conversões) dos eventos da página,
// com o mesmo event_id do píxel para a Meta não contar a dobrar.
export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false }, 400); }
  const evt = parseEvent(body);
  if (!evt) return json({ ok: false }, 400);
  const t = trackingFrom(request, body);
  const r = await sendMetaEvent({ ...evt, url: t.url, user: { ip: t.ip, ua: t.ua, fbp: t.fbp, fbc: t.fbc } });
  return json({ ok: true, sent: !r.skipped });
}
