// Catálogo de la oferta. Los precios viven SOLO en el servidor: el navegador
// envía qué order bumps eligió, nunca montos.
// Montos en centavos de peso mexicano (unidad minoritaria).

export const CURRENCY = 'MXN';
export const COUNTRY = 'MX';

export const PRODUCT = {
  id: 'kit-semillas-de-esperanza',
  name: 'Kit Semillas de Esperanza completo',
  amount: 15000, // $150.00 MXN
};

// Esta oferta no tiene order bumps (un solo plan). Se deja el catálogo vacío
// para que el resto del flujo funcione igual.
export const BUMPS = {};

/**
 * Calcula el pedido. Los ids de bumps desconocidos se ignoran.
 * @param {unknown} bumpIds
 * @returns {{ items: {id:string,name:string,amount:number}[], bumps: string[], amount: number }}
 */
export function priceOrder(bumpIds) {
  const list = Array.isArray(bumpIds) ? bumpIds : [];
  const chosen = [...new Set(list.filter((id) => typeof id === 'string' && Object.hasOwn(BUMPS, id)))].sort();
  const items = [{ id: PRODUCT.id, name: PRODUCT.name, amount: PRODUCT.amount }, ...chosen.map((id) => ({ ...BUMPS[id] }))];
  const amount = items.reduce((sum, it) => sum + it.amount, 0);
  return { items, bumps: chosen, amount };
}

// Formas de pago que ofrecemos (aunque Zenith libere más en la cuenta).
export const ALLOWED_METHODS = ['spei'];

// Enlace que recibe el comprador SOLO después de que el webhook confirma el pago.
export const DEFAULT_VIP_GROUP_URL = 'https://chat.whatsapp.com/I8DT4AbT0qs0JQfFoJhlfH?mode=gi_t';
