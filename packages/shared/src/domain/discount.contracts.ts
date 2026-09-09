/**
 * Contratos del desglose de descuentos (SCS-R1.5 - SCS-R1.7).
 * Es la forma exacta que devuelve POST /api/checkout/preview.
 */

/** El orden del arreglo ES el orden de precedencia de la cascada. */
export const DISCOUNT_NAMES = ['CATEGORY', 'VOLUME', 'COUPON'] as const;
export type DiscountName = (typeof DISCOUNT_NAMES)[number];

export interface DiscountLine {
  name: DiscountName;
  /** Texto listo para la UI, no vacio incluso cuando applied es false. */
  label: string;
  applied: boolean;
  /** Entero 0..10000. */
  rateBps: number;
  /** Exacto, sin redondear. */
  baseAmountMicros: number;
  /** Derivado, SOLO presentacion: nunca se opera con el. */
  baseAmountCents: number;
  /** Exacto, sin redondear. */
  discountMicros: number;
  /** Reparto por mayor resto; la suma de las lineas es rawDiscountCents. */
  discountCents: number;
}

export interface CheckoutTotals {
  originalSubtotalCents: number;
  /** 3 elementos cuando el motor se arma desde el factory. */
  lines: DiscountLine[];
  /** Cascada exacta, antes de redondear y antes de topar. */
  rawDiscountMicros: number;
  /** El unico redondeo de todo el calculo. */
  rawDiscountCents: number;
  /** floor(originalSubtotalCents * 3500 / 10000). */
  capCents: number;
  /** true solo si rawDiscountCents > capCents (estrictamente mayor). */
  capApplied: boolean;
  /** Ya topado: min(rawDiscountCents, capCents). */
  totalSavingsCents: number;
  effectiveDiscountBps: number;
  /** Derivado: originalSubtotalCents - totalSavingsCents. */
  finalTotalCents: number;
}
