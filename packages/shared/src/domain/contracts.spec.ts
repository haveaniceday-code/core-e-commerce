import { describe, expect, it } from 'vitest';
import { CATEGORY_LABEL, PRODUCT_CATEGORIES } from './categories';
import { COUPON_STATUSES } from './coupon';
import { DISCOUNT_NAMES } from './discount.contracts';
import { ERROR_CODES } from './errors';
import type { ApiError } from './errors';

describe('categorias (SCS-R1.1, SCS-R1.2)', () => {
  it('declara los tres literales sin tilde, en orden', () => {
    expect(PRODUCT_CATEGORIES).toEqual(['Tecnologia', 'Hogar', 'Ropa']);
  });

  it('la tilde vive solo en la etiqueta, nunca en la clave', () => {
    expect(CATEGORY_LABEL.Tecnologia).toBe('Tecnología');
    expect(Object.keys(CATEGORY_LABEL)).toEqual(['Tecnologia', 'Hogar', 'Ropa']);
    expect(Object.keys(CATEGORY_LABEL)).not.toContain('Tecnología');
  });

  it('CATEGORY_LABEL tiene una entrada por categoria', () => {
    expect(Object.keys(CATEGORY_LABEL)).toHaveLength(PRODUCT_CATEGORIES.length);
    for (const c of PRODUCT_CATEGORIES) {
      expect(CATEGORY_LABEL[c].length).toBeGreaterThan(0);
    }
  });
});

describe('uniones cerradas derivadas de as const (MF-R2.3)', () => {
  it('DISCOUNT_NAMES declara la precedencia de la cascada', () => {
    expect(DISCOUNT_NAMES).toEqual(['CATEGORY', 'VOLUME', 'COUPON']);
  });

  it('COUPON_STATUSES declara activo y expirado', () => {
    expect(COUPON_STATUSES).toEqual(['active', 'expired']);
  });

  it('ERROR_CODES declara los tres codigos del contrato', () => {
    expect(ERROR_CODES).toEqual([
      'INSUFFICIENT_STOCK', 'PRODUCT_NOT_FOUND', 'INVALID_CART',
    ]);
  });
});

describe('forma de ApiError (SCS-R1.7)', () => {
  it('admite details ausente sin alterar el resto del contrato', () => {
    const sinDetails: ApiError = {
      error: { code: 'INVALID_CART', message: 'Carrito invalido' },
    };
    expect(sinDetails.error.details).toBeUndefined();
    expect(sinDetails.error.code).toBe('INVALID_CART');
  });

  it('admite details como Record<string, unknown>', () => {
    const conDetails: ApiError = {
      error: {
        code: 'PRODUCT_NOT_FOUND',
        message: 'No existe',
        details: { productId: 'PROD-999', lineIndex: 0 },
      },
    };
    expect(conDetails.error.details).toEqual({ productId: 'PROD-999', lineIndex: 0 });
  });
});
