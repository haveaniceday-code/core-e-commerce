import { PRODUCT_CATEGORIES } from '@core/shared';

/**
 * Dato persistido corrupto (BP-R4.7). Identifica el `id` y el valor invalido para que
 * el fallo sea diagnosticable; el filtro lo traduce a un 500 generico y jamas propaga
 * estos datos al cliente.
 *
 * No hereda de `DiscountDomainError` porque no es un error de dominio del calculo:
 * es una violacion de integridad del almacen.
 */
export class CorruptProductRowError extends Error {
  constructor(
    readonly productId: string,
    readonly invalidCategory: string,
  ) {
    super(
      `La fila ${productId} tiene la categoria "${invalidCategory}", ajena a ${PRODUCT_CATEGORIES.join(' | ')}.`,
    );
    this.name = 'CorruptProductRowError';
  }
}

export const isCorruptProductRowError = (value: unknown): value is CorruptProductRowError =>
  value instanceof CorruptProductRowError;
