import { applyBps } from '../../money/micro';
import { notApplied } from '../discount.types';
import type { DiscountContext, DiscountResult, DiscountStrategy } from '../discount.types';

/** Descuento del cupon sobre el remanente tras VOLUME (DE-R1.8, DE-R1.9). */
export class CouponDiscount implements DiscountStrategy {
  readonly name = 'COUPON' as const;
  readonly order = 3;

  /**
   * findCouponByCode devuelve el cupon aunque este expirado: el registro
   * informa, la estrategia juzga (SCS-R2.4). Un codigo ausente, vacio, no
   * registrado o expirado se ignora SIN LANZAR y sin tocar los montos que
   * aportaron CATEGORY y VOLUME.
   */
  isApplicable(ctx: DiscountContext): boolean {
    return ctx.coupon !== undefined && ctx.coupon.status === 'active';
  }

  apply(ctx: DiscountContext): DiscountResult {
    const { coupon } = ctx;
    if (coupon === undefined || coupon.status !== 'active') {
      return notApplied(this.name);
    }

    const baseAmountMicros = ctx.remainingSubtotalMicros;

    return {
      name: this.name,
      applied: true,
      rateBps: coupon.rateBps,
      baseAmountMicros,
      discountMicros: applyBps(baseAmountMicros, coupon.rateBps),
    };
  }
}
