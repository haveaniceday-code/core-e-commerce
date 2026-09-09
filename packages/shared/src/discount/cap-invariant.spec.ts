import { describe, expect, it } from 'vitest';
import type { DiscountName } from '../domain/discount.contracts';
import { applyBps } from '../money/micro';
import { CATALOG_PRODUCTS } from '../seed/catalog.seed';
import { DiscountEngine } from './discount-engine';
import { DiscountStrategyFactory } from './discount-strategy.factory';
import type { DiscountContext, DiscountResult, DiscountStrategy } from './discount.types';

/**
 * Doble de prueba TIPADO contra DiscountStrategy: sin any, sin `as` de
 * silenciamiento y sin @ts-ignore (DE-R6.3).
 *
 * Los bps se eligen de modo que `x bps / 10000` siga dando enteros exactos en
 * micro-centavos, para que el invariante de enteros se mantenga tambien aqui.
 */
class StubDiscount implements DiscountStrategy {
  constructor(
    readonly name: DiscountName,
    readonly order: number,
    private readonly rateBps: number,
  ) {}

  isApplicable(): boolean {
    return true;
  }

  apply(ctx: DiscountContext): DiscountResult {
    return {
      name: this.name,
      applied: true,
      rateBps: this.rateBps,
      baseAmountMicros: ctx.remainingSubtotalMicros,
      discountMicros: applyBps(ctx.remainingSubtotalMicros, this.rateBps),
    };
  }
}

// Subtotal de 10.000 centavos: hace que 1 bps valga exactamente 1 centavo, de
// modo que las fronteras capCents-1 / capCents / capCents+1 se puedan expresar
// como tasas. capCents = floor(10000 * 3500 / 10000) = 3500.
const CATALOG = [
  { id: 'X', name: 'X', category: 'Ropa', priceCents: 10_000, stock: 99 },
] as const;
const ITEMS = [{ productId: 'X', quantity: 1 }] as const;

/** Motor con una unica estrategia stub cuyo descuento es `bps` del subtotal. */
const engineWithRate = (bps: number): DiscountEngine =>
  new DiscountEngine([new StubDiscount('CATEGORY', 1, bps)]);

describe('el tope se activa por exceso estricto (DE-R6.4)', () => {
  it('exceso: trunca en capCents y reporta capApplied', () => {
    // 50% sobre 10000 = 5000 crudo, contra un tope de 3500.
    const totals = engineWithRate(5000).calculate({ items: ITEMS, catalog: CATALOG });

    expect(totals.rawDiscountCents).toBe(5_000);
    expect(totals.capApplied).toBe(true);
    expect(totals.totalSavingsCents).toBe(totals.capCents);
    expect(totals.capCents).toBe(Math.floor((10_000 * 3500) / 10_000));
    expect(totals.finalTotalCents).toBe(totals.originalSubtotalCents - totals.totalSavingsCents);
    expect(totals.effectiveDiscountBps).toBeLessThanOrEqual(3500);
  });

  it('justo por debajo (capCents - 1): no trunca', () => {
    const totals = engineWithRate(3499).calculate({ items: ITEMS, catalog: CATALOG });
    expect(totals.rawDiscountCents).toBe(totals.capCents - 1);
    expect(totals.capApplied).toBe(false);
    expect(totals.totalSavingsCents).toBe(totals.rawDiscountCents);
  });

  it('igualdad exacta (capCents): el 35% clavado NO trunca', () => {
    const totals = engineWithRate(3500).calculate({ items: ITEMS, catalog: CATALOG });
    expect(totals.rawDiscountCents).toBe(totals.capCents);
    expect(totals.capApplied).toBe(false);
    expect(totals.totalSavingsCents).toBe(totals.rawDiscountCents);
  });

  it('justo por encima (capCents + 1): trunca', () => {
    const totals = engineWithRate(3501).calculate({ items: ITEMS, catalog: CATALOG });
    expect(totals.rawDiscountCents).toBe(totals.capCents + 1);
    expect(totals.capApplied).toBe(true);
    expect(totals.totalSavingsCents).toBe(totals.capCents);
  });

  it('con el tope activo, las lineas siguen sumando rawDiscountCents (DE-R6.6)', () => {
    const totals = engineWithRate(5000).calculate({ items: ITEMS, catalog: CATALOG });
    const suma = totals.lines.reduce((a, l) => a + l.discountCents, 0);

    expect(suma).toBe(totals.rawDiscountCents);
    // La diferencia contra el ahorro reportado es exactamente lo truncado.
    expect(suma - totals.totalSavingsCents).toBe(
      totals.rawDiscountCents - totals.capCents,
    );
    expect(suma - totals.totalSavingsCents).toBeGreaterThan(0);
  });

  it('el motor recorre por indice, no por order (DE-R2.3)', () => {
    const engine = new DiscountEngine([
      new StubDiscount('COUPON', 3, 1000),
      new StubDiscount('CATEGORY', 1, 1000),
    ]);
    const totals = engine.calculate({ items: ITEMS, catalog: CATALOG });
    expect(totals.lines.map((l) => l.name)).toEqual(['COUPON', 'CATEGORY']);
  });
});

describe('el tope sobre el catalogo real (DE-R6.8)', () => {
  const engine = new DiscountEngine(new DiscountStrategyFactory().create());
  const carritoCompleto = CATALOG_PRODUCTS.map((p) => ({
    productId: p.id,
    quantity: p.stock,
  }));

  it('DEMOCAP50 es el unico camino de datos que dispara el truncamiento', () => {
    const totals = engine.calculate({
      items: carritoCompleto,
      catalog: CATALOG_PRODUCTS,
      couponCode: 'DEMOCAP50',
    });
    expect(totals.capApplied).toBe(true);
    expect(totals.totalSavingsCents).toBe(totals.capCents);
  });

  it('con los cupones del enunciado el tope NUNCA se activa', () => {
    // Documenta el hallazgo del tope inalcanzable (max 27.325%) y falla si
    // alguien cambia una tasa sin revisarlo.
    for (const couponCode of [undefined, 'WELCOME2026', 'SUMMER2024', 'NO-EXISTE']) {
      const totals = engine.calculate({
        items: carritoCompleto,
        catalog: CATALOG_PRODUCTS,
        ...(couponCode === undefined ? {} : { couponCode }),
      });
      expect(totals.capApplied).toBe(false);
      expect(totals.rawDiscountCents).toBeLessThanOrEqual(totals.capCents);
      expect(totals.effectiveDiscountBps).toBeLessThanOrEqual(2733);
    }
  });
});
