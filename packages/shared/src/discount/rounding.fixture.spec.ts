import { describe, expect, it } from 'vitest';
import { CATALOG_PRODUCTS } from '../seed/catalog.seed';
import { DiscountEngine } from './discount-engine';
import { DiscountStrategyFactory } from './discount-strategy.factory';

const engine = new DiscountEngine(new DiscountStrategyFactory().create());
const cart = (productId: string, quantity: number) => [{ productId, quantity }];

describe('fixture canonico de redondeo (DE-R6.5)', () => {
  const totals = engine.calculate({
    items: cart('PROD-001', 1),
    catalog: CATALOG_PRODUCTS,
    couponCode: 'WELCOME2026',
  });

  it('produce 35495 y NO 35496', () => {
    // Half-up por paso daria 12990 + 5846 + 16660 = 35496. Este test es la
    // defensa contra una regresion a redondeo en cascada.
    expect(totals.rawDiscountCents).toBe(35495);
    expect(totals.totalSavingsCents).toBe(35495);
    expect(totals.rawDiscountCents).not.toBe(35496);
  });

  it('reparte las lineas como 12990 / 5845 / 16660', () => {
    expect(totals.lines.map((l) => l.discountCents)).toEqual([12990, 5845, 16660]);
  });

  it('congela la cascada exacta en micro-centavos', () => {
    expect(totals.rawDiscountMicros).toBe(35_495_175_000);
    expect(totals.lines.map((l) => l.discountMicros)).toEqual([
      12_990_000_000, 5_845_500_000, 16_659_675_000,
    ]);
  });

  it('congela el resto de los totales', () => {
    expect(totals.originalSubtotalCents).toBe(129900);
    expect(totals.capCents).toBe(45465);
    expect(totals.capApplied).toBe(false);
    expect(totals.effectiveDiscountBps).toBe(2732);
    expect(totals.finalTotalCents).toBe(94405);
  });

  it('la cascada es multiplicativa, no una suma de porcentajes (DE-R3.6)', () => {
    // Sumar 1000 + 500 + 1500 bps daria 3000; la cascada da 2732.
    expect(totals.effectiveDiscountBps).toBeLessThan(3000);
    const sumaDeTasas = Math.round((129900 * 3000) / 10_000);
    expect(totals.totalSavingsCents).not.toBe(sumaDeTasas);
  });
});

describe('fixture sin cupon (DE-R3.4)', () => {
  it('resuelve el empate exacto de .5 hacia arriba', () => {
    const totals = engine.calculate({
      items: cart('PROD-001', 1),
      catalog: CATALOG_PRODUCTS,
    });
    expect(totals.rawDiscountMicros).toBe(18_835_500_000);
    expect(totals.rawDiscountCents).toBe(18836);
  });
});

describe('suma de lineas contra rawDiscountCents (DE-R6.6)', () => {
  it('suma exactamente, con un centavo sobrante repartido', () => {
    const totals = engine.calculate({
      items: cart('PROD-001', 1),
      catalog: CATALOG_PRODUCTS,
      couponCode: 'WELCOME2026',
    });
    const suma = totals.lines.reduce((a, l) => a + l.discountCents, 0);
    expect(suma).toBe(totals.rawDiscountCents);

    // Los pisos suman 35494: hubo exactamente un centavo que repartir.
    const pisos = totals.lines.reduce((a, l) => a + Math.floor(l.discountMicros / 1_000_000), 0);
    expect(totals.rawDiscountCents - pisos).toBe(1);
  });
});
