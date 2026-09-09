import { largestRemainderWinners } from '../money/allocate';
import { BPS_DENOMINATOR, MICRO, roundHalfUp } from '../money/micro';
import { DISCOUNT_LABEL } from './discount.labels';
import type { CheckoutTotals, DiscountLine } from '../domain/discount.contracts';
import type { DiscountResult } from './discount.types';

/** Tope absoluto del descuento: 35% del subtotal original. */
export const CAP_BPS = 3500;

/**
 * Convierte la cascada exacta en CheckoutTotals (DE-R4).
 *
 * ES EL UNICO PUNTO DEL SISTEMA AUTORIZADO A REDONDEAR. Las estrategias
 * devuelven micro-centavos exactos; aqui ocurre el unico roundHalfUp.
 */
export const assembleTotals = (
  results: readonly DiscountResult[],
  originalSubtotalCents: number,
): CheckoutTotals => {
  // 1-2. Suma exacta y EL UNICO REDONDEO del calculo.
  const rawDiscountMicros = results.reduce((acc, r) => acc + r.discountMicros, 0);
  const rawDiscountCents = roundHalfUp(rawDiscountMicros);

  // 3-5. Tope con floor (nunca ceil) y comparacion ESTRICTAMENTE MAYOR.
  const capCents = Math.floor((originalSubtotalCents * CAP_BPS) / BPS_DENOMINATOR);
  const totalSavingsCents = Math.min(rawDiscountCents, capCents);
  const capApplied = rawDiscountCents > capCents;

  // 6. Derivado, nunca por otra via: no puede desincronizarse del desglose.
  const finalTotalCents = originalSubtotalCents - totalSavingsCents;

  // Lo que el tope recorto. Se calcula aqui y no en la UI porque el frontend no opera con
  // montos: es la resta que hace cuadrar el desglose en pantalla, y su unico dueno es este
  // ensamblador. Sin truncamiento vale 0, sin necesidad de ramificar.
  const capAdjustmentCents = rawDiscountCents - totalSavingsCents;

  // 7. Sin dividir cuando el subtotal es 0.
  const effectiveDiscountBps =
    originalSubtotalCents === 0
      ? 0
      : Math.round((totalSavingsCents * BPS_DENOMINATOR) / originalSubtotalCents);

  // 8. Reparto por mayor resto contra rawDiscountCents, tambien con capApplied.
  const winners = largestRemainderWinners(
    results.map((r) => r.discountMicros),
    rawDiscountCents,
  );

  const lines: DiscountLine[] = results.map((r, index) => ({
    name: r.name,
    label: DISCOUNT_LABEL[r.name],
    applied: r.applied,
    rateBps: r.rateBps,
    baseAmountMicros: r.baseAmountMicros,
    // 9. Presentacion pura: nunca se opera con el.
    baseAmountCents: roundHalfUp(r.baseAmountMicros),
    discountMicros: r.discountMicros,
    discountCents: Math.floor(r.discountMicros / MICRO) + (winners.has(index) ? 1 : 0),
  }));

  return {
    originalSubtotalCents,
    lines,
    rawDiscountMicros,
    rawDiscountCents,
    capCents,
    capApplied,
    totalSavingsCents,
    capAdjustmentCents,
    effectiveDiscountBps,
    finalTotalCents,
  };
};
