/**
 * Formateo de dinero (SCS-R3.4).
 *
 * Dueno unico del formateo para todo el monorepo: backend y frontend lo importan
 * en lugar de reimplementarlo, y asi el mismo monto se pinta identico en el
 * carrito, el desglose y la confirmacion.
 *
 * Agrupa la parte entera con Intl SOBRE UN ENTERO y concatena los dos decimales
 * como cadena. Nunca formatea un float ni usa toFixed: toFixed redondea, y un
 * redondeo en presentacion seria un segundo punto de redondeo en un sistema que
 * declara tener uno solo.
 */
const GROUPER = new Intl.NumberFormat('en-US');

export const formatCents = (cents: number): string => {
  const whole = Math.trunc(cents / 100);
  const frac = cents % 100;
  return `$${GROUPER.format(whole)}.${String(frac).padStart(2, '0')}`;
};
