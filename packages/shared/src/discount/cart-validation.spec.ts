import { describe, expect, it } from 'vitest';
import { DiscountDomainError, isDiscountDomainError } from '../domain/errors';
import { CATALOG_PRODUCTS } from '../seed/catalog.seed';
import { DiscountEngine } from './discount-engine';
import { DiscountStrategyFactory } from './discount-strategy.factory';

const engine = new DiscountEngine(new DiscountStrategyFactory().create());
const calc = (items: readonly { productId: string; quantity: number }[]) =>
  () => engine.calculate({ items, catalog: CATALOG_PRODUCTS });

/** Captura el error tipado sin usar assertions (MF-R2.4). */
const catchDomainError = (fn: () => unknown): DiscountDomainError => {
  try {
    fn();
  } catch (e) {
    if (isDiscountDomainError(e)) return e;
    throw e;
  }
  throw new Error('se esperaba un DiscountDomainError y no se lanzo ninguno');
};

describe('carrito corrupto (DE-R5.1 - DE-R5.3)', () => {
  it('cantidad negativa o cero lanza INVALID_CART con el indice', () => {
    for (const quantity of [-1, 0]) {
      const err = catchDomainError(calc([{ productId: 'PROD-001', quantity }]));
      expect(err.code).toBe('INVALID_CART');
      expect(err.details).toMatchObject({ lineIndex: 0, productId: 'PROD-001' });
    }
  });

  it('cantidad no entera finita lanza INVALID_CART', () => {
    for (const quantity of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(catchDomainError(calc([{ productId: 'PROD-001', quantity }])).code)
        .toBe('INVALID_CART');
    }
  });

  it('productId ausente lanza PRODUCT_NOT_FOUND con el id', () => {
    const err = catchDomainError(calc([{ productId: 'PROD-999', quantity: 1 }]));
    expect(err.code).toBe('PRODUCT_NOT_FOUND');
    expect(err.details).toMatchObject({ productId: 'PROD-999' });
  });

  it('precio invalido lanza INVALID_CART', () => {
    const catalog = [
      { id: 'BAD', name: 'Bad', category: 'Ropa', priceCents: -1, stock: 1 },
    ] as const;
    const err = catchDomainError(() =>
      engine.calculate({ items: [{ productId: 'BAD', quantity: 1 }], catalog }),
    );
    expect(err.code).toBe('INVALID_CART');
    expect(err.details).toMatchObject({ productId: 'BAD', priceCents: -1 });
  });

  it('el subtotal por encima de la cota lanza INVALID_CART (DE-R5.6)', () => {
    const catalog = [
      { id: 'HUGE', name: 'Huge', category: 'Ropa', priceCents: 9_000_000_000, stock: 9 },
    ] as const;
    const err = catchDomainError(() =>
      engine.calculate({ items: [{ productId: 'HUGE', quantity: 2 }], catalog }),
    );
    expect(err.code).toBe('INVALID_CART');
  });
});

describe('orden de validacion (DE-R5.7)', () => {
  it('resuelve el productId ANTES de validar la cantidad', () => {
    // Linea con ambos defectos: gana PRODUCT_NOT_FOUND.
    const err = catchDomainError(calc([{ productId: 'NO-EXISTE', quantity: -5 }]));
    expect(err.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('lanza solo el PRIMER error, recorriendo por indice ascendente', () => {
    const err = catchDomainError(
      calc([
        { productId: 'PROD-001', quantity: 1 },
        { productId: 'PROD-002', quantity: -1 },
        { productId: 'NO-EXISTE', quantity: 1 },
      ]),
    );
    expect(err.code).toBe('INVALID_CART');
    expect(err.details).toMatchObject({ lineIndex: 1 });
  });

  it('no devuelve totales parciales ni muta la entrada', () => {
    const items = [{ productId: 'PROD-001', quantity: -1 }];
    const snapshot = JSON.stringify(items);
    expect(calc(items)).toThrow(DiscountDomainError);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe('contrato del error tipado (DE-R5.5)', () => {
  it('expone code, message no vacio y details opcional', () => {
    const err = catchDomainError(calc([{ productId: 'PROD-999', quantity: 1 }]));
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DiscountDomainError');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('se serializa al contrato ApiError compartido', () => {
    const err = catchDomainError(calc([{ productId: 'PROD-999', quantity: 1 }]));
    expect(err.toApiError()).toEqual({
      error: {
        code: 'PRODUCT_NOT_FOUND',
        message: err.message,
        details: { lineIndex: 0, productId: 'PROD-999' },
      },
    });
  });

  it('omite details cuando no hay', () => {
    const sinDetails = new DiscountDomainError('INVALID_CART', 'sin detalles');
    expect(sinDetails.toApiError().error.details).toBeUndefined();
    expect('details' in sinDetails.toApiError().error).toBe(false);
  });

  it('isDiscountDomainError narrowea sin assertions', () => {
    expect(isDiscountDomainError(new Error('otro'))).toBe(false);
    expect(isDiscountDomainError(null)).toBe(false);
  });
});

describe('lo que NO es un error (DE-R5.4)', () => {
  it('el cupon invalido no tumba el checkout', () => {
    for (const couponCode of ['', 'NO-EXISTE', 'SUMMER2024', 'welcome2026']) {
      const totals = engine.calculate({
        items: [{ productId: 'PROD-001', quantity: 1 }],
        catalog: CATALOG_PRODUCTS,
        couponCode,
      });
      const coupon = totals.lines.find((l) => l.name === 'COUPON');
      expect(coupon?.applied).toBe(false);
      expect(coupon?.discountCents).toBe(0);
      // CATEGORY y VOLUME conservan lo que tendrian sin cupon.
      expect(totals.rawDiscountCents).toBe(18836);
    }
  });
});
