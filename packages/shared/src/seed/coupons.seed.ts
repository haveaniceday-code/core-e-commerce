import type { Coupon } from '../domain/coupon';

/**
 * Cupones canonicos (SCS-R2.1 - SCS-R2.3). Valores transcritos desde
 * .kiro/steering/product-rules.md, que es su unica fuente.
 */
export const COUPONS = [
  { code: 'WELCOME2026', rateBps: 1500, status: 'active',  isDemoExtension: false },
  { code: 'SUMMER2024',  rateBps: 2000, status: 'expired', isDemoExtension: false },
  // Extension de demo ajena al enunciado: el tope del 35% es inalcanzable con
  // las reglas literales (max 27.325%), asi que este cupon es el unico camino de
  // datos que dispara el truncamiento y la alerta de descuento limite alcanzado.
  { code: 'DEMOCAP50',   rateBps: 5000, status: 'active',  isDemoExtension: true  },
] as const satisfies readonly Coupon[];

/**
 * Comparacion exacta y sensible a mayusculas, sin normalizar ni recortar
 * (SCS-R2.4). Devuelve el cupon TAMBIEN cuando esta expirado: la decision de
 * ignorarlo es de la estrategia, no del registro. El registro informa, no juzga;
 * si ocultara el expirado, "no existe" y "existe pero vencio" serian
 * indistinguibles.
 */
export const findCouponByCode = (code: string): Coupon | undefined =>
  COUPONS.find((c) => c.code === code);
