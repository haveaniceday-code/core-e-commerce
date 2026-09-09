export const COUPON_STATUSES = ['active', 'expired'] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

/** Cupon registrado (SCS-R2.2, SCS-R2.3). */
export interface Coupon {
  readonly code: string;
  /** Entero en puntos basicos, 0..10000. Nunca float. */
  readonly rateBps: number;
  readonly status: CouponStatus;
  /**
   * Marca de extension ajena al enunciado. Es campo del contrato y no un
   * comentario porque DE-R6.8 lo consulta para excluir el cupon de demo del
   * barrido que afirma `capApplied === false`.
   */
  readonly isDemoExtension: boolean;
}
