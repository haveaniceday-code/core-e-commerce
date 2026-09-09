import type { Coupon } from '../domain/coupon';
import type { DiscountName } from '../domain/discount.contracts';
import type { ProductCategory } from '../domain/categories';

/** Linea de carrito ya resuelta contra el catalogo (DE-R1.10). */
export interface ResolvedCartLine {
  readonly productId: string;
  readonly category: ProductCategory;
  readonly priceCents: number;
  readonly quantity: number;
}

/** Todo monto en micro-centavos enteros; toda tasa en bps enteros. */
export interface DiscountContext {
  readonly lines: readonly ResolvedCartLine[];
  readonly originalSubtotalMicros: number;
  readonly remainingSubtotalMicros: number;
  readonly coupon?: Coupon;
}

/**
 * SIN NINGUN CAMPO EN CENTAVOS (DE-R1.2).
 *
 * Es la pieza de tipado que hace cumplir el principio rector: una estrategia no
 * puede redondear sin que se note, porque no tiene donde poner el resultado. La
 * conversion a centavos es exclusiva del ensamblador de totales.
 */
export interface DiscountResult {
  readonly name: DiscountName;
  readonly applied: boolean;
  readonly rateBps: number;
  readonly baseAmountMicros: number;
  readonly discountMicros: number;
}

export interface DiscountStrategy {
  readonly name: DiscountName;
  readonly order: number;
  isApplicable(ctx: DiscountContext): boolean;
  apply(ctx: DiscountContext): DiscountResult;
}

/** Resultado vacio de una estrategia no aplicable (DE-R1.5, DE-R4.7). */
export const notApplied = (name: DiscountName): DiscountResult => ({
  name,
  applied: false,
  rateBps: 0,
  baseAmountMicros: 0,
  discountMicros: 0,
});
