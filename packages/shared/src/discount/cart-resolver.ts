import { DiscountDomainError } from '../domain/errors';
import { MAX_SUBTOTAL_CENTS, toMicros } from '../money/micro';
import { findCouponByCode } from '../seed/coupons.seed';
import type { CartItem, Product } from '../domain/product';
import type { DiscountContext, ResolvedCartLine } from './discount.types';

export interface DiscountCalculationInput {
  readonly items: readonly CartItem[];
  readonly catalog: readonly Product[];
  readonly couponCode?: string;
}

const isNonNegativeInteger = (n: number): boolean => Number.isInteger(n) && n >= 0;

/**
 * Resuelve cada CartItem contra el catalogo y valida la linea (DE-R5).
 *
 * Orden fijo: recorre las lineas en indice ascendente y, dentro de cada una,
 * resuelve PRIMERO el productId y valida DESPUES quantity y priceCents. Lanza
 * unicamente el primer error detectado y detiene el calculo.
 *
 * Lanzar antes de ejecutar cualquier estrategia es lo que hace verdadera la
 * garantia de no mutacion: nada llego a tocar el carrito (DE-R5.7).
 */
export const resolveCart = (input: DiscountCalculationInput): DiscountContext => {
  const lines: ResolvedCartLine[] = [];
  let subtotalCents = 0;

  for (const [index, item] of input.items.entries()) {
    const product = input.catalog.find((p) => p.id === item.productId);
    if (product === undefined) {
      throw new DiscountDomainError(
        'PRODUCT_NOT_FOUND',
        `El producto ${item.productId} no existe en el catalogo.`,
        { lineIndex: index, productId: item.productId },
      );
    }

    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new DiscountDomainError(
        'INVALID_CART',
        `La cantidad de la linea ${String(index)} debe ser un entero mayor a 0.`,
        { lineIndex: index, productId: item.productId, quantity: item.quantity },
      );
    }

    if (!isNonNegativeInteger(product.priceCents)) {
      throw new DiscountDomainError(
        'INVALID_CART',
        `El precio de ${product.id} debe ser un entero mayor o igual a 0.`,
        { lineIndex: index, productId: product.id, priceCents: product.priceCents },
      );
    }

    subtotalCents += product.priceCents * item.quantity;
    lines.push({
      productId: product.id,
      category: product.category,
      priceCents: product.priceCents,
      quantity: item.quantity,
    });
  }

  // Unica guarda de rango con error de todo el paquete (DE-R5.6).
  if (subtotalCents > MAX_SUBTOTAL_CENTS) {
    throw new DiscountDomainError(
      'INVALID_CART',
      `El subtotal supera la cota de exactitud de ${String(MAX_SUBTOTAL_CENTS)} centavos.`,
      { subtotalCents, maxSubtotalCents: MAX_SUBTOTAL_CENTS },
    );
  }

  const originalSubtotalMicros = toMicros(subtotalCents);

  // Un codigo ausente, vacio o no registrado deja el contexto sin cupon; que la
  // cascada continue e ignore la linea COUPON es asunto de la estrategia, no un
  // error (DE-R5.4). El spread condicional lo exige exactOptionalPropertyTypes:
  // "coupon ausente" y "coupon: undefined" no son lo mismo.
  const coupon =
    input.couponCode === undefined ? undefined : findCouponByCode(input.couponCode);

  return {
    lines,
    originalSubtotalMicros,
    remainingSubtotalMicros: originalSubtotalMicros,
    ...(coupon === undefined ? {} : { coupon }),
  };
};
