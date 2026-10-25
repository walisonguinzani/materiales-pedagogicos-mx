# Educación de la Esperanza · Landing page + checkout SPEI

Landing page en español (México) del **Kit Semillas de Esperanza** (material pedagógico cristiano para niños y adultos) con checkout propio integrado a la **Zenith Payments API** (SPEI). Precio único: **$150 MXN**.

El sitio **no entrega archivos**: cuando el webhook firmado de Zenith confirma el pago, la página de gracias muestra el enlace del **Grupo VIP de WhatsApp**. Los PDFs del kit no están en este repositorio; solo las portadas como vista previa.

## Estructura
| Ruta | Qué es |
|---|---|
| `index.html` | Landing page (estructura basada en la página del Portal da Pedagogia) |
| `checkout.html` | Checkout: datos, forma de pago (SPEI) e instrucciones de pago |
| `gracias.html` | Espera la confirmación y muestra el enlace del Grupo VIP |
| `terminos.html` · `privacidad.html` | Términos y Condiciones · Aviso de Privacidad (con exención de Meta/Facebook) |
| `api/payment-methods.js` | `GET` formas de pago disponibles (consulta a Zenith en tiempo real) |
| `api/checkout.js` | `POST` crea el checkout (idempotente) |
| `api/checkout-status.js` | `GET` estado del pedido para la pantalla del comprador |
| `api/webhooks/zenith.js` | `POST` webhook firmado: **única** confirmación de pago |
| `api/_lib/pricing.js` | Precio ($150 MXN) y enlace del Grupo VIP |
| `assets/` | Estilos, fuentes (Lora y Poppins, OFL), ilustraciones y portadas |
| `tests/` | Pruebas (`npm test`) |
| `tools/dev-server.js` | Servidor local, con modo simulado |

## Precio y enlace del grupo
- Precio en centavos, solo en el servidor: `api/_lib/pricing.js` → `PRODUCT.amount = 15000`.
- Enlace del grupo: `DEFAULT_VIP_GROUP_URL` en el mismo archivo, o la variable `VIP_GROUP_URL` en Vercel (tiene prioridad). Solo se entrega después del pago confirmado.

## Cómo funciona el pago
1. `checkout.html` consulta `/api/payment-methods` y muestra solo SPEI (si Zenith lo tiene activo para MX/MXN). Si Zenith pide RFC y fecha de nacimiento, el formulario los muestra.
2. Cada intento lleva un `requestId`; el servidor guarda su propia `Idempotency-Key`. Los reintentos usan la misma llave y el mismo payload: nunca se duplica el cobro.
3. El comprador ve la CLABE, el beneficiario, la referencia y el monto tal como los devuelve Zenith.
4. El pedido se marca pagado **solo** con el webhook firmado (`payment.captured` o `checkout.succeeded`): HMAC SHA-256, ventana de 300 s, `X-Zenith-Event-Id` único, `referenceId`, monto y moneda.

## Configuración en Vercel
1. Importa este repositorio en Vercel (framework: *Other*, sin build).
2. En **Storage**, crea una base **Upstash Redis / KV** y conéctala al proyecto (crea `KV_REST_API_URL` y `KV_REST_API_TOKEN`).
3. En **Settings → Environment Variables**, agrega las variables de `.env.example` (las llaves de Zenith nunca van en el código).
4. Genera un secreto para el webhook (`openssl rand -hex 32`) y guárdalo como `ZENITH_WEBHOOK_SECRET`.
5. Registra el webhook en Zenith (una sola vez, desde tu computadora):
   ```bash
   curl -X POST https://api.zenithworld.com.br/integrations/webhooks/endpoints \
     -H "X-API-Key: $ZENITH_PUBLIC_KEY" -H "X-API-Secret: $ZENITH_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{"name":"Semillas de Esperanza pedidos","url":"https://TU-DOMINIO/api/webhooks/zenith","secret":"'$ZENITH_WEBHOOK_SECRET'","events":["payment.captured","payment.pending","payment.failed","checkout.succeeded"]}'
   ```
6. Revisa `https://TU-DOMINIO/api/health`: muestra qué variables están configuradas (sí/no, nunca valores).

## Píxel de Meta (opcional)
Está apagado por defecto. Para activarlo, pon el ID en `<meta name="meta-pixel" content="TU_ID">` de `index.html`, `checkout.html` y `gracias.html`, y en Vercel `META_PIXEL_ID` y `META_CAPI_TOKEN`.

## Probar en local
```bash
npm test                          # pruebas
node tools/dev-server.js --mock   # simula Zenith, sin cobros reales → http://localhost:8080
```
En modo simulado, abre `http://localhost:8080/__mock/pagar?ref=REFERENCIA` para enviar un webhook firmado de prueba y ver la página de gracias con el enlace del grupo.
