// Render de instrucciones de pago a partir del nextAction devuelto por el servidor.
// Solo se muestra lo que viene en la respuesta: no se inventan datos.

export const fmt = (cents) =>
  '$' + (cents / 100).toLocaleString('es-MX', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' MXN';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ETIQUETAS = {
  clabe: 'CLABE', bankName: 'Banco', beneficiary: 'Beneficiario', beneficiaryName: 'Beneficiario', accountHolder: 'Beneficiario',
  reference: 'Referencia', accountNumber: 'Cuenta', concept: 'Concepto', rfc: 'RFC', amount: 'Monto',
};
const etiqueta = (k) => ETIQUETAS[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

function cargarScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

async function copiar(texto, btn) {
  try {
    await navigator.clipboard.writeText(texto);
    btn.textContent = '¡Copiado!';
  } catch {
    const r = document.createRange();
    const el = btn.closest('[data-copia]')?.querySelector('[data-valor]');
    if (el) { r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    btn.textContent = 'Selecciona y copia';
  }
  setTimeout(() => { btn.textContent = 'Copiar'; }, 2200);
}

/**
 * @param {HTMLElement} el
 * @param {{ amount:number, method?:{displayName?:string, iconUrl?:string|null}|null, nextAction?:any }} pedido
 */
export function renderPago(el, pedido) {
  const na = pedido.nextAction || {};
  const m = pedido.method || {};
  const titulo = na.instructions?.title || `Paga con ${m.displayName || 'tu método elegido'}`;
  let cuerpo = '';

  if (na.type === 'voucher' && na.code) {
    cuerpo += `<div class="ref" data-copia><small>Tu referencia de pago</small><code data-valor>${esc(na.code)}</code>
      <svg class="barcode" id="barcode" role="img" aria-label="Código de barras de la referencia"></svg>
      <p style="margin-top:12px"><button type="button" class="copiar" data-copiar="${esc(na.code)}">Copiar</button></p></div>`;
  } else if (na.type === 'bank_transfer' && na.details && Object.keys(na.details).length) {
    cuerpo += '<div class="datos">' + Object.entries(na.details).map(([k, v]) =>
      `<div class="dato" data-copia><small>${esc(etiqueta(k))}</small><span data-valor>${esc(v)}</span><button type="button" class="copiar" data-copiar="${esc(v)}">Copiar</button></div>`).join('') + '</div>';
    cuerpo += `<div class="dato" style="border:1.5px solid var(--guia);border-radius:14px;margin-bottom:18px"><small>Monto exacto</small><span>${fmt(pedido.amount)}</span></div>`;
  } else if (na.type === 'qr_code' && na.code) {
    cuerpo += `<div class="ref"><small>Escanea para pagar</small><div id="qr" style="display:grid;place-items:center;margin-top:10px"></div></div>`;
  } else if (na.type === 'redirect' && na.url) {
    cuerpo += `<p style="margin:18px 0"><a class="btn btn-oro" href="${esc(na.url)}" rel="noopener">Continuar al pago seguro</a></p>`;
  } else if (na.type === 'app_approval') {
    cuerpo += `<div class="aviso info" style="margin:18px 0">Abre la aplicación ${esc(na.app || '')} en tu celular y aprueba la solicitud de pago.</div>`;
  } else {
    cuerpo += `<div class="aviso info" style="margin:18px 0">Estamos preparando las instrucciones de tu pago. Esta página se actualiza sola.</div>`;
  }
  if (na.paymentPageUrl) cuerpo += `<p style="margin-bottom:16px"><a class="btn btn-sec" href="${esc(na.paymentPageUrl)}" rel="noopener">Ver instrucciones en una página aparte</a></p>`;

  const pasos = na.instructions?.steps?.length ? `<h3 style="font-size:18px;margin-top:6px">Cómo pagar</h3><ol class="pasos-pago">${na.instructions.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '';
  const vence = na.presentation?.expiresAt ? `<p class="vence">Paga antes del ${esc(new Date(na.presentation.expiresAt).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' }))}.</p>` : '';

  el.innerHTML = `<div class="pago-cab">${m.iconUrl ? `<img src="${esc(m.iconUrl)}" alt="" onerror="this.remove()">` : ''}<div><h2>${esc(titulo)}</h2><p class="ayuda">Total a pagar</p></div></div>
    <p class="pago-monto">${fmt(pedido.amount)}</p>${cuerpo}${pasos}${vence}
    <div class="estado" id="estado" role="status"><span class="pulso" aria-hidden="true"></span><span id="estadoTxt">Esperando la confirmación de tu pago. Esta página se actualiza sola.</span></div>`;

  el.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', () => copiar(b.dataset.copiar, b)));

  if (na.type === 'voucher' && na.code) {
    cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js')
      .then(() => window.JsBarcode('#barcode', na.code, { format: 'CODE128', displayValue: false, height: 70, margin: 0, lineColor: '#2E3A1D' }))
      .catch(() => document.getElementById('barcode')?.remove());
  }
  if (na.type === 'qr_code' && na.code) {
    cargarScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js')
      .then(() => new window.QRCode(document.getElementById('qr'), { text: na.code, width: 220, height: 220, colorDark: '#2E3A1D' }))
      .catch(() => { document.getElementById('qr').textContent = na.code; });
  }
}

/**
 * Consulta el estado cada pocos segundos. Solo "paid" (confirmado por webhook) libera el acceso.
 * @param {string} ref @param {string} t @param {(s:any)=>void} onUpdate
 */
export function vigilarEstado(ref, t, onUpdate) {
  let parar = false, espera = 6000;
  async function tick() {
    if (parar) return;
    try {
      const r = await fetch(`/api/checkout-status?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(t)}`, { cache: 'no-store' });
      if (r.ok) {
        const s = await r.json();
        onUpdate(s);
        if (s.status === 'paid') return;
      }
    } catch { /* reintenta */ }
    espera = Math.min(espera * 1.25, 20000);
    setTimeout(tick, document.hidden ? 20000 : espera);
  }
  tick();
  return () => { parar = true; };
}
