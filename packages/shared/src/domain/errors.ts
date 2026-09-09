/**
 * Contrato de error compartido (SCS-R1.7).
 *
 * INSUFFICIENT_STOCK se declara aqui aunque quien lo emita viva en el backend:
 * el contrato es compartido y partirlo obligaria a redeclarar la union.
 */
export const ERROR_CODES = [
  'INSUFFICIENT_STOCK',
  'PRODUCT_NOT_FOUND',
  'INVALID_CART',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    /**
     * `Record<string, unknown>`, nunca `any`: el consumidor esta obligado a
     * estrechar antes de leer. Bajo exactOptionalPropertyTypes su ausencia
     * significa verdaderamente "ausente".
     */
    details?: Record<string, unknown>;
  };
}
