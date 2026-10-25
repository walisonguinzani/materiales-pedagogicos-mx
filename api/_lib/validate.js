// Validación de datos del comprador antes de llamar a Zenith.
// Zenith rechaza nombres o correos de prueba (422), así que filtramos aquí
// para dar un mensaje claro en español.

const NAME_PART = /^[\p{L}][\p{L}'’.-]*$/u;
const DISPOSABLE = new Set([
  'example.com', 'example.org', 'test.com', 'prueba.com', 'mailinator.com', 'guerrillamail.com',
  'yopmail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'trashmail.com', 'sharklasers.com',
]);

/** @param {unknown} v */
export function cleanName(v) {
  return typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
}

/** @param {unknown} v */
export function cleanEmail(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/**
 * @param {string} name
 * @returns {string|null} mensaje de error o null
 */
export function nameError(name) {
  if (!name) return 'Escribe tu nombre y apellido.';
  if (name.length > 120) return 'El nombre es demasiado largo.';
  const parts = name.split(' ');
  if (parts.length < 2) return 'Escribe tu nombre y al menos un apellido.';
  if (parts.some((p) => !NAME_PART.test(p))) return 'El nombre solo puede tener letras.';
  if (parts.filter((p) => p.replace(/[^\p{L}]/gu, '').length >= 2).length < 2) return 'Escribe tu nombre y apellido completos, sin iniciales.';
  if (parts.some((p) => /(.)\1{2,}/iu.test(p))) return 'Revisa tu nombre: parece tener letras repetidas.';
  return null;
}

/**
 * @param {string} email
 * @returns {string|null}
 */
export function emailError(email) {
  if (!email) return 'Escribe tu correo electrónico.';
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return 'Revisa tu correo: parece incompleto.';
  const domain = email.split('@')[1];
  if (DISPOSABLE.has(domain) || /^(test|prueba|ejemplo|example)@/.test(email)) return 'Usa tu correo real: ahí te enviamos tu acceso.';
  return null;
}

/** @param {unknown} v */
export function isUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

// ---- Datos extra que exige SPEI (identificación fiscal del pagador) ----
const RFC_RE = /^([A-ZÑ&]{3,4})(\d{2})(\d{2})(\d{2})([A-Z\d]{2}[A\d])$/;

/** @param {unknown} v */
export function cleanRfc(v) {
  return typeof v === 'string' ? v.toUpperCase().replace(/[\s-]/g, '') : '';
}

/** @param {string} rfc @returns {string|null} */
export function rfcError(rfc) {
  if (!rfc) return 'Escribe tu RFC con homoclave.';
  const m = rfc.match(RFC_RE);
  if (!m) return 'Revisa tu RFC: son 13 caracteres, por ejemplo GOMA900115AB1.';
  const mm = Number(m[3]), dd = Number(m[4]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return 'Revisa tu RFC: la fecha no es válida.';
  if (/^XAXX|^XEXX/.test(rfc)) return 'Usa tu RFC personal, no el genérico.';
  return null;
}

/** @param {unknown} v @param {Date} [today] @returns {string|null} */
export function birthDateError(v, today = new Date()) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Escribe tu fecha de nacimiento.';
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return 'Revisa tu fecha de nacimiento.';
  const age = (today.getTime() - d.getTime()) / (365.25 * 86400000);
  if (age < 18) return 'Para pagar por SPEI necesitas ser mayor de edad.';
  if (age > 110) return 'Revisa tu fecha de nacimiento.';
  return null;
}

/** @param {unknown} v */
export function cleanCountry(v) {
  return typeof v === 'string' && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : '';
}

/** Separa nombre(s) y apellido(s): primer palabra = nombre, el resto = apellidos. @param {string} full */
export function splitName(full) {
  const parts = full.split(' ');
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}
