import { describe, expect, it } from 'vitest';
import { CATALOG_PRODUCTS } from '../seed/catalog.seed';
import { DiscountEngine } from './discount-engine';
import { DiscountStrategyFactory } from './discount-strategy.factory';

const engine = new DiscountEngine(new DiscountStrategyFactory().create());
const run = (items: readonly { productId: string; quantity: number }[], couponCode?: string) =>
  engine.calculate({
    items,
    catalog: CATALOG_PRODUCTS,
    ...(couponCode === undefined ? {} : { couponCode }),
  });

describe('DiscountStrategyFactory (DE-R2.1)', () => {
  it('devuelve las tres estrategias ordenadas por order', () => {
    const strategies = new DiscountStrategyFactory().create();
    expect(strategies.map((s) => [s.name, s.order])).toEqual([
      ['CATEGORY', 1], ['VOLUME', 2], ['COUPON', 3],
    ]);
  });
});

describe('escenarios de cascada (DE-R6 casos de cascada)', () => {
  it('solo categoria: subtotal bajo el umbral de volumen, sin cupon', () => {
    // 1 x PROD-003 (Tecnologia, 4550) => no supera 10000 tras categoria.
    const t = run([{ productId: 'PROD-003', quantity: 1 }]);
    expect(t.lines.map((l) => l.applied)).toEqual([true, false, false]);
    expect(t.lines[0]?.discountMicros).toBe(455_000_000);
    expect(t.rawDiscountCents).toBe(455);
  });

  it('categoria + volumen, sin cupon', () => {
    const t = run([{ productId: 'PROD-001', quantity: 1 }]);
    expect(t.lines.map((l) => l.applied)).toEqual([true, true, false]);
    expect(t.lines.map((l) => l.discountMicros)).toEqual([
      12_990_000_000, 5_845_500_000, 0,
    ]);
  });

  it('las tres reglas combinadas', () => {
    const t = run([{ productId: 'PROD-001', quantity: 1 }], 'WELCOME2026');
    expect(t.lines.map((l) => l.applied)).toEqual([true, true, true]);
    expect(t.lines.map((l) => l.rateBps)).toEqual([1000, 500, 1500]);
  });

  it('solo volumen: carrito sin Tecnologia que supera el umbral', () => {
    // 3 x PROD-005 (Hogar, 5900) = 17700.
    const t = run([{ productId: 'PROD-005', quantity: 3 }]);
    expect(t.lines.map((l) => l.applied)).toEqual([false, true, false]);
    expect(t.lines[1]?.baseAmountMicros).toBe(17_700_000_000);
  });

  it('la base de COUPON es el remanente exacto que dejo VOLUME (DE-R6.10)', () => {
    const t = run([{ productId: 'PROD-001', quantity: 1 }], 'WELCOME2026');
    const [cat, vol, cup] = t.lines;
    expect(cup?.baseAmountMicros).toBe(
      t.lines[0] && t.lines[1]
        ? 129_900_000_000 - (cat?.discountMicros ?? 0) - (vol?.discountMicros ?? 0)
        : 0,
    );
    expect(cup?.discountMicros).toBe(((cup?.baseAmountMicros ?? 0) * 1500) / 10_000);
  });
});

describe('inyeccion de estrategias (DE-R2.2 - DE-R2.5)', () => {
  it('con lista vacia devuelve ceros y lines vacio, sin lanzar', () => {
    const vacio = new DiscountEngine([]);
    const t = vacio.calculate({
      items: [{ productId: 'PROD-001', quantity: 1 }],
      catalog: CATALOG_PRODUCTS,
    });
    expect(t.lines).toEqual([]);
    expect(t.rawDiscountMicros).toBe(0);
    expect(t.rawDiscountCents).toBe(0);
    expect(t.totalSavingsCents).toBe(0);
    expect(t.capApplied).toBe(false);
    expect(t.finalTotalCents).toBe(t.originalSubtotalCents);
  });

  it('no muta la lista de estrategias recibida', () => {
    const strategies = new DiscountStrategyFactory().create();
    const snapshot = strategies.map((s) => s.name);
    const e = new DiscountEngine(strategies);
    e.calculate({ items: [{ productId: 'PROD-001', quantity: 1 }], catalog: CATALOG_PRODUCTS });
    expect(strategies.map((s) => s.name)).toEqual(snapshot);
  });

  it('emite una linea por estrategia recibida', () => {
    const dos = new DiscountEngine(new DiscountStrategyFactory().create().slice(0, 2));
    const t = dos.calculate({
      items: [{ productId: 'PROD-001', quantity: 1 }],
      catalog: CATALOG_PRODUCTS,
    });
    expect(t.lines).toHaveLength(2);
  });
});

describe('carrito vacio (DE-R6.9)', () => {
  it('devuelve ceros y las tres lineas, sin lanzar', () => {
    const t = run([]);
    expect(t.originalSubtotalCents).toBe(0);
    expect(t.rawDiscountMicros).toBe(0);
    expect(t.rawDiscountCents).toBe(0);
    expect(t.capCents).toBe(0);
    expect(t.capApplied).toBe(false);
    expect(t.totalSavingsCents).toBe(0);
    expect(t.effectiveDiscountBps).toBe(0);
    expect(t.finalTotalCents).toBe(0);
    expect(t.lines).toHaveLength(3);
    expect(t.lines.every((l) => !l.applied && l.discountCents === 0)).toBe(true);
  });
});

describe('invariantes de los totales (DE-R4)', () => {
  const carritos = [
    { items: [], coupon: undefined },
    { items: [{ productId: 'PROD-006', quantity: 1 }], coupon: undefined },
    { items: [{ productId: 'PROD-001', quantity: 1 }], coupon: 'WELCOME2026' },
    { items: [{ productId: 'PROD-001', quantity: 2 }, { productId: 'PROD-004', quantity: 5 }], coupon: 'DEMOCAP50' },
    { items: CATALOG_PRODUCTS.map((p) => ({ productId: p.id, quantity: p.stock })), coupon: 'SUMMER2024' },
  ];

  it('conserva el subtotal y respeta los rangos del tope', () => {
    for (const { items, coupon } of carritos) {
      const t = run(items, coupon);
      expect(t.finalTotalCents + t.totalSavingsCents).toBe(t.originalSubtotalCents);
      expect(t.capCents).toBe(Math.floor((t.originalSubtotalCents * 3500) / 10_000));
      expect(t.totalSavingsCents).toBeGreaterThanOrEqual(0);
      expect(t.totalSavingsCents).toBeLessThanOrEqual(t.capCents);
      expect(t.capCents).toBeLessThanOrEqual(t.originalSubtotalCents);
      expect(t.effectiveDiscountBps).toBeGreaterThanOrEqual(0);
      expect(t.effectiveDiscountBps).toBeLessThanOrEqual(3500);
      expect(t.capApplied).toBe(t.rawDiscountCents > t.capCents);
      expect(t.lines.reduce((a, l) => a + l.discountCents, 0)).toBe(t.rawDiscountCents);
    }
  });

  it('emite todo monto como entero no negativo (DE-R4.10)', () => {
    for (const { items, coupon } of carritos) {
      const t = run(items, coupon);
      const montos = [
        t.originalSubtotalCents, t.rawDiscountMicros, t.rawDiscountCents, t.capCents,
        t.totalSavingsCents, t.effectiveDiscountBps, t.finalTotalCents,
        ...t.lines.flatMap((l) => [
          l.rateBps, l.baseAmountMicros, l.baseAmountCents, l.discountMicros, l.discountCents,
        ]),
      ];
      for (const m of montos) {
        expect(Number.isInteger(m)).toBe(true);
        expect(m).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('es determinista y no muta la entrada', () => {
    const items = [{ productId: 'PROD-001', quantity: 1 }];
    const snapshot = JSON.stringify(items);
    expect(run(items, 'WELCOME2026')).toEqual(run(items, 'WELCOME2026'));
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it('toda linea no aplicada lleva label no vacio y montos en 0 (DE-R4.7)', () => {
    const t = run([{ productId: 'PROD-006', quantity: 1 }]);
    for (const l of t.lines.filter((x) => !x.applied)) {
      expect(l.label.length).toBeGreaterThan(0);
      expect([l.rateBps, l.baseAmountMicros, l.baseAmountCents, l.discountMicros, l.discountCents])
        .toEqual([0, 0, 0, 0, 0]);
    }
  });
});
