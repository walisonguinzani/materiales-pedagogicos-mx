// Píxel da Meta (só no navegador) e ligação ao checkout da Hotmart.
// O ID do píxel vai em <meta name="meta-pixel" content="O_TEU_ID"> no index.html.
// Se estiver vazio, o píxel não é carregado. As compras são medidas pela Hotmart
// (configura lá o mesmo píxel em Ferramentas → Pixel de rastreamento).
const PIXEL_ID = (document.querySelector('meta[name="meta-pixel"]')?.content || '').trim();
const ATIVO = /^\d{6,20}$/.test(PIXEL_ID);

if (ATIVO) {
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');
}

const VALOR = { value: 16.90, currency: 'EUR' };

/** Evento de navegação no navegador. */
export function trackNav(name, data = VALOR) {
  if (ATIVO) window.fbq('track', name, data);
}

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
    a.addEventListener('click', () => trackNav('InitiateCheckout'));
  });
}
