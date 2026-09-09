import { CATEGORY_LABEL } from '../domain/categories';
import type { DiscountName } from '../domain/discount.contracts';

/**
 * Etiquetas del desglose (DE-R4.7).
 *
 * El label lo pone el ensamblador desde este Record, NO la estrategia: asi una
 * linea no aplicada conserva un label no vacio sin que la estrategia se ejecute.
 * Si viviera en la estrategia, el ensamblador tendria que invocarla incluso con
 * isApplicable === false, o el label quedaria vacio.
 *
 * La tilde se toma de CATEGORY_LABEL; nunca se escribe a mano aqui (MF-R2.5).
 */
export const DISCOUNT_LABEL: Record<DiscountName, string> = {
  CATEGORY: `Descuento ${CATEGORY_LABEL.Tecnologia} 10%`,
  VOLUME: 'Descuento por volumen 5%',
  COUPON: 'Cupón',
};
