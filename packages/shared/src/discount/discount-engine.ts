import { MICRO } from '../money/micro';
import { resolveCart } from './cart-resolver';
import { assembleTotals } from './totals-assembler';
import type { CheckoutTotals } from '../domain/discount.contracts';
import type { DiscountCalculationInput } from './cart-resolver';
import type { DiscountContext, DiscountResult, DiscountStrategy } from './discount.types';

/**
 * Motor de descuentos acumulativos (DE-R2, DE-R3).
 *
 * Recibe las estrategias POR CONSTRUCTOR y no las construye internamente. No es
 * conveniencia de inyeccion de dependencias, es testabilidad de un invariante:
 * el tope del 35% es inalcanzable con las tasas reales (max 27.325%), asi que la
 * unica forma de ejercitar el truncamiento es inyectar tasas altas.
 */
export class DiscountEngine {
  constructor(private readonly strategies: readonly DiscountStrategy[]) {}

  calculate(input: DiscountCalculationInput): CheckoutTotals {
    // Valida y resuelve ANTES de ejecutar ninguna estrategia (DE-R5.7).
    const initial = resolveCart(input);
    const originalSubtotalCents = initial.originalSubtotalMicros / MICRO;

    const results: DiscountResult[] = [];
    let remainingSubtotalMicros = initial.originalSubtotalMicros;

    // Recorre por ORDEN DE INDICE de la lista recibida, sin reordenar por
    // `order` ni omitir elementos (DE-R2.3).
    for (const strategy of this.strategies) {
      const ctx: DiscountContext = { ...initial, remainingSubtotalMicros };
      const result = strategy.isApplicable(ctx)
        ? strategy.apply(ctx)
        : { name: strategy.name, applied: false, rateBps: 0, baseAmountMicros: 0, discountMicros: 0 };

      results.push(result);
      // Entero exacto: sin redondear ni truncar en ningun paso (DE-R3.2).
      remainingSubtotalMicros -= result.discountMicros;
    }

    return assembleTotals(results, originalSubtotalCents);
  }
}
