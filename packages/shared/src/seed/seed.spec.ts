import { describe, expect, it } from 'vitest';
import { CATALOG_PRODUCTS, findProductById } from './catalog.seed';
import { COUPONS, findCouponByCode } from './coupons.seed';
import { PRODUCT_CATEGORIES } from '../domain/categories';

describe('catalogo del seed (SCS-R2.1)', () => {
  it('contiene exactamente los seis productos de product-rules.md', () => {
    expect(CATALOG_PRODUCTS).toHaveLength(6);
    expect(CATALOG_PRODUCTS.map((p) => p.id)).toEqual([
      'PROD-001', 'PROD-002', 'PROD-003', 'PROD-004', 'PROD-005', 'PROD-006',
    ]);
    expect(CATALOG_PRODUCTS.map((p) => p.priceCents)).toEqual([
      129900, 7990, 4550, 3200, 5900, 1990,
    ]);
    expect(CATALOG_PRODUCTS.map((p) => p.stock)).toEqual([5, 12, 8, 15, 3, 20]);
  });

  it('tiene ids unicos', () => {
    expect(new Set(CATALOG_PRODUCTS.map((p) => p.id)).size).toBe(CATALOG_PRODUCTS.length);
  });

  it('tiene precios enteros positivos y stock entero no negativo', () => {
    for (const p of CATALOG_PRODUCTS) {
      expect(Number.isInteger(p.priceCents)).toBe(true);
      expect(p.priceCents).toBeGreaterThan(0);
      expect(Number.isInteger(p.stock)).toBe(true);
      expect(p.stock).toBeGreaterThanOrEqual(0);
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('usa categorias de la union cerrada, siempre sin tilde', () => {
    for (const p of CATALOG_PRODUCTS) {
      expect(PRODUCT_CATEGORIES).toContain(p.category);
      expect(p.category).not.toContain('í');
    }
  });
});

describe('cupones del seed (SCS-R2.1 - SCS-R2.3)', () => {
  it('contiene exactamente los tres cupones de product-rules.md', () => {
    expect(COUPONS).toHaveLength(3);
    expect(COUPONS.map((c) => [c.code, c.rateBps, c.status])).toEqual([
      ['WELCOME2026', 1500, 'active'],
      ['SUMMER2024', 2000, 'expired'],
      ['DEMOCAP50', 5000, 'active'],
    ]);
  });

  it('expresa toda tasa como entero en bps dentro de 0..10000', () => {
    for (const c of COUPONS) {
      expect(Number.isInteger(c.rateBps)).toBe(true);
      expect(c.rateBps).toBeGreaterThanOrEqual(0);
      expect(c.rateBps).toBeLessThanOrEqual(10_000);
    }
  });

  it('marca como extension de demo solo a DEMOCAP50 (SCS-R2.3)', () => {
    const demoExtensions = COUPONS.filter((c) => c.isDemoExtension).map((c) => c.code);
    expect(demoExtensions).toEqual(['DEMOCAP50']);
  });
});

describe('resolucion de cupones (SCS-R2.4, SCS-R2.5)', () => {
  it('devuelve el cupon registrado con todos sus campos', () => {
    expect(findCouponByCode('WELCOME2026')).toEqual({
      code: 'WELCOME2026', rateBps: 1500, status: 'active', isDemoExtension: false,
    });
  });

  it('devuelve el cupon TAMBIEN cuando esta expirado', () => {
    const expired = findCouponByCode('SUMMER2024');
    expect(expired).toBeDefined();
    expect(expired?.status).toBe('expired');
  });

  it('compara de forma exacta y sensible a mayusculas, sin recortar', () => {
    expect(findCouponByCode('welcome2026')).toBeUndefined();
    expect(findCouponByCode(' WELCOME2026 ')).toBeUndefined();
  });

  it('devuelve undefined ante codigo no registrado o vacio, sin lanzar', () => {
    expect(findCouponByCode('NOPE')).toBeUndefined();
    expect(findCouponByCode('')).toBeUndefined();
  });
});

describe('resolucion de productos (SCS-R2.5)', () => {
  it('resuelve por id exacto contra el catalogo por defecto', () => {
    expect(findProductById('PROD-001')?.priceCents).toBe(129900);
  });

  it('devuelve undefined ante un id ausente, sin lanzar', () => {
    expect(findProductById('PROD-999')).toBeUndefined();
    expect(findProductById('')).toBeUndefined();
  });

  it('acepta un catalogo a medida', () => {
    const custom = [
      { id: 'X-1', name: 'X', category: 'Ropa', priceCents: 100, stock: 1 },
    ] as const;
    expect(findProductById('X-1', custom)?.name).toBe('X');
    expect(findProductById('PROD-001', custom)).toBeUndefined();
  });
});
