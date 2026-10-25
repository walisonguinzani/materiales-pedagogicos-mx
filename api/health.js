import { json } from './_lib/http.js';

// GET /api/health → qué variables de entorno están configuradas (solo sí/no, nunca valores).
export async function GET() {
  const has = (k) => Boolean(process.env[k]);
  return json({
    ZENITH_PUBLIC_KEY: has('ZENITH_PUBLIC_KEY'),
    ZENITH_SECRET_KEY: has('ZENITH_SECRET_KEY'),
    ZENITH_WEBHOOK_SECRET: has('ZENITH_WEBHOOK_SECRET'),
    ZENITH_ENVIRONMENT: process.env.ZENITH_ENVIRONMENT || 'production',
    database: has('KV_REST_API_URL') && has('KV_REST_API_TOKEN') || has('UPSTASH_REDIS_REST_URL') && has('UPSTASH_REDIS_REST_TOKEN'),
    SITE_URL: has('SITE_URL'),
    VIP_GROUP_URL: has('VIP_GROUP_URL') ? 'configurado' : 'por defecto (enlace del grupo en el código)',
    META_CAPI_TOKEN: has('META_CAPI_TOKEN'),
    META_PIXEL_ID: process.env.META_PIXEL_ID || 'sin configurar (no se envían eventos)',
    META_TEST_EVENT_CODE: has('META_TEST_EVENT_CODE'),
  });
}
