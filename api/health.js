// GET /api/health → mostra se o token está configurado (sim/não, nunca o valor).
export async function GET() {
  return new Response(JSON.stringify({
    META_CAPI_TOKEN: Boolean(process.env.META_CAPI_TOKEN),
    META_PIXEL_ID: process.env.META_PIXEL_ID || '1556039792956905 (por defeito)',
    META_TEST_EVENT_CODE: Boolean(process.env.META_TEST_EVENT_CODE),
  }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
