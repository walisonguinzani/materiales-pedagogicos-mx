// Píxel de Meta + copia de servidor (API de Conversiones) con el mismo event_id.
// El ID del píxel se pone en <meta name="meta-pixel" content="TU_ID"> de cada página.
// Si está vacío, no se carga el píxel ni se envían eventos.
const PIXEL_ID = (document.querySelector('meta[name="meta-pixel"]')?.content || '').trim();
const ACTIVO = /^\d{6,20}$/.test(PIXEL_ID);

if (ACTIVO) {
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');
}

function cookie(n) { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }

/** fbp y fbc para enviar al servidor (fbc se arma con fbclid si aún no existe la cookie). */
export function metaIds() {
  let fbc = cookie('_fbc');
  const fbclid = new URLSearchParams(location.search).get('fbclid');
  if (!fbc && fbclid) {
    fbc = `fb.1.${Date.now()}.${fbclid}`;
    if (ACTIVO) { try { document.cookie = `_fbc=${fbc}; max-age=${90 * 86400}; path=/; SameSite=Lax`; } catch {} }
  }
  return { fbp: cookie('_fbp'), fbc, pageUrl: location.href.split('#')[0] };
}

const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

/** Evento de navegación: navegador + servidor con el mismo id. */
export function trackNav(name, data = { value: 150, currency: 'MXN' }) {
  if (!ACTIVO) return;
  const eventId = `${name.toLowerCase()}_${nuevoId()}`;
  window.fbq('track', name, data, { eventID: eventId });
  // Esperar un poco a que el píxel cree la cookie _fbp.
  setTimeout(() => {
    try {
      fetch('/api/meta-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ name, eventId, ...metaIds() }) }).catch(() => {});
    } catch {}
  }, 1200);
}

/** Evento de pedido (id fijo: el servidor envía el mismo). Solo una vez por pedido en este navegador. */
export function trackOrder(name, ref, value, eventId) {
  if (!ACTIVO) return;
  const k = `meta:${eventId}`;
  try { if (localStorage.getItem(k)) return; localStorage.setItem(k, '1'); } catch {}
  window.fbq('track', name, { value, currency: 'MXN', content_name: 'Kit Semillas de Esperanza', content_type: 'product' }, { eventID: eventId });
}
