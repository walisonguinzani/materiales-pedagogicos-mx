// Píxel da Meta + cópia no servidor (API de Conversões, /api/meta-event) com o mesmo event_id,
// para a Meta juntar os dois e não contar a dobrar. O token NUNCA vai neste ficheiro:
// fica na variável META_CAPI_TOKEN do Vercel.
// O ID do píxel vai em <meta name="meta-pixel" content="..."> no index.html.
// A compra (Purchase) é medida pela Hotmart (Ferramentas → Pixel de rastreamento).
const PIXEL_ID = (document.querySelector('meta[name="meta-pixel"]')?.content || '').trim();
const ATIVO = /^\d{6,20}$/.test(PIXEL_ID);

if (ATIVO) {
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', PIXEL_ID);
}

const VALOR = { value: 16.90, currency: 'EUR' };

function cookie(n) { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }

/** fbp e fbc para o servidor (o fbc é criado a partir do fbclid se ainda não existir). */
function metaIds() {
  let fbc = cookie('_fbc');
  const fbclid = new URLSearchParams(location.search).get('fbclid');
  if (!fbc && fbclid) {
    fbc = `fb.1.${Date.now()}.${fbclid}`;
    try { document.cookie = `_fbc=${fbc}; max-age=${90 * 86400}; path=/; SameSite=Lax`; } catch {}
  }
  return { fbp: cookie('_fbp'), fbc, pageUrl: location.href.split('#')[0] };
}

const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

function enviarServidor(name, eventId) {
  try {
    fetch('/api/meta-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ name, eventId, ...metaIds() }) }).catch(() => {});
  } catch {}
}

/**
 * Evento no navegador + cópia no servidor com o mesmo event_id.
 * @param {string} name @param {object} [data] @param {{ imediato?: boolean }} [o]
 */
export function trackNav(name, data = VALOR, o = {}) {
  if (!ATIVO) return;
  const eventId = `${name.toLowerCase()}_${novoId()}`;
  window.fbq('track', name, name === 'PageView' ? {} : data, { eventID: eventId });
  // Espera um pouco para o píxel criar a cookie _fbp; num clique para o checkout envia logo.
  if (o.imediato) enviarServidor(name, eventId);
  else setTimeout(() => enviarServidor(name, eventId), 1200);
}

if (ATIVO) trackNav('PageView');

// Parâmetros que a Hotmart aceita para atribuir a venda à campanha.
const PARAMS = /^(utm_(source|medium|campaign|content|term|id)|src|sck|fbclid|xcod)$/;

/** Passa os UTMs da página para os links do checkout e mede o clique como InitiateCheckout. */
export function linkCheckout(links) {
  const atual = new URLSearchParams(location.search);
  links.forEach((a) => {
    try {
      const url = new URL(a.href);
      for (const [k, v] of atual) if (PARAMS.test(k) && !url.searchParams.has(k)) url.searchParams.set(k, v.slice(0, 300));
      a.href = url.toString();
    } catch {}
    a.addEventListener('click', () => trackNav('InitiateCheckout', VALOR, { imediato: true }));
  });
}
