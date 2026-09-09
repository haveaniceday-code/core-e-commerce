import { applyBps, toMicros } from '../../money/micro';
import { notApplied } from '../discount.types';
import type { DiscountContext, DiscountResult, DiscountStrategy } from '../discount.types';

/** Umbral en centavos: 100 USD. */
export const VOLUME_THRESHOLD_CENTS = 10_000;

/** 5% sobre todo el remanente cuando supera el umbral (DE-R1.6, DE-R1.7). */
export class VolumeDiscount implements DiscountStrategy {
  readonly name = 'VOLUME' as const;
  readonly order = 2;
  readonly rateBps = 500;

  /**
   * ESTRICTAMENTE MAYOR, y comparado en micro-centavos SIN redondear antes a
   * centavos: exactamente toMicros(10000) no activa el 5%, toMicros(10000)+1 si.
   * Redondear el remanente para compararlo meteria un redondeo intermedio por la
   * puerta de atras y moveria la frontera.
   */
  isApplicable(ctx: DiscountContext): boolean {
    return ctx.remainingSubtotalMicros > toMicros(VOLUME_THRESHOLD_CENTS);
  }

  /**
   * La base es el remanente COMPLETO tras CATEGORY, abarcando todas las
   * categorias y no solo Tecnologia (DE-R1.7).
   */
  apply(ctx: DiscountContext): DiscountResult {
    if (!this.isApplicable(ctx)) return notApplied(this.name);

    const baseAmountMicros = ctx.remainingSubtotalMicros;

    return {
      name: this.name,
      applied: true,
      rateBps: this.rateBps,
      baseAmountMicros,
      discountMicros: applyBps(baseAmountMicros, this.rateBps),
    };
  }
}
