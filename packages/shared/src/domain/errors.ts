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
  // Extension de infraestructura ajena al enunciado (BP-R5.7), en la misma linea
  // en que DEMOCAP50 es extension de demo: ninguno de los tres codigos canonicos
  // describe un fallo interno del servidor. Emitir INVALID_CART en un 500 seria
  // mentirle al cliente y al log; silenciarlo con una assertion esta prohibido.
  // Se mapea a 500 en el filtro de excepciones del backend, que mantiene la
  // union exhaustiva en su Record<ErrorCode, number>.
  'INTERNAL_ERROR',
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

/**
 * Error tipado del dominio (DE-R5.5).
 *
 * No importa NestJS, no expone codigos de estado HTTP y no depende de Prisma:
 * el mapeo a 409 / 404 / 400 es responsabilidad de un filtro de excepciones del
 * backend.
 */
export class DiscountDomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'DiscountDomainError';
  }

  toApiError(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: { ...this.details } }),
      },
    };
  }
}

/**
 * Narrowea desde `unknown` sin assertions. Sin este guard, un `catch (e)`
 * obligaria a un `as`, que esta prohibido (MF-R2.4).
 */
export const isDiscountDomainError = (value: unknown): value is DiscountDomainError =>
  value instanceof DiscountDomainError;
