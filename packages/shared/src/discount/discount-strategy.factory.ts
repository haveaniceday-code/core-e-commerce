import { CategoryDiscount } from './strategies/category.discount';
import { CouponDiscount } from './strategies/coupon.discount';
import { VolumeDiscount } from './strategies/volume.discount';
import type { DiscountStrategy } from './discount.types';

/**
 * Construye la lista ordenada de estrategias de produccion (DE-R2.1).
 *
 * Devuelve SIEMPRE LAS TRES, ordenadas de forma ascendente por `order`, con
 * independencia de si resultan aplicables: el desglose de la UI necesita las
 * tres lineas, aplicadas o no. Anadir una cuarta regla se hace aqui, y el motor
 * la recorre y emite su linea sin modificarse.
 */
export class DiscountStrategyFactory {
  create(): readonly DiscountStrategy[] {
    return [new CategoryDiscount(), new VolumeDiscount(), new CouponDiscount()];
  }
}
