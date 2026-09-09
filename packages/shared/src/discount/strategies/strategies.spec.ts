import { describe, expect, it } from 'vitest';
import { CATEGORY_LABEL } from '../../domain/categories';
import { toMicros } from '../../money/micro';
import { findCouponByCode } from '../../seed/coupons.seed';
import type { DiscountContext } from '../discount.types';
import { CategoryDiscount } from './category.discount';
import { CouponDiscount } from './coupon.discount';
import { VolumeDiscount, VOLUME_THRESHOLD_CENTS } from './volume.discount';

const ctx = (over: Partial<DiscountContext> = {}): DiscountContext => ({
  lines: [],
  originalSubtotalMicros: 0,
  remainingSubtotalMicros: 0,
  ...over,
});

const line = (category: 'Tecnologia' | 'Hogar' | 'Ropa', priceCents: number, quantity = 1) => ({
  productId: `P-${category}`,
  category,
  priceCents,
  quantity,
});

describe('CategoryDiscount (DE-R1.3 - DE-R1.5)', () => {
  const strategy = new CategoryDiscount();

  it('declara name, order y tasa', () => {
    expect([strategy.name, strategy.order, strategy.rateBps]).toEqual(['CATEGORY', 1, 1000]);
  });

  it('opera SOLO sobre las lineas Tecnologia de un carrito mixto (DE-R1.4)', () => {
    const lines = [line('Tecnologia', 10_000), line('Hogar', 5_000), line('Ropa', 2_000)];
    const c = ctx({ lines, originalSubtotalMicros: toMicros(17_000) });
    const result = strategy.apply(c);

    expect(result.baseAmountMicros).toBe(toMicros(10_000));
    expect(result.baseAmountMicros).toBeLessThan(c.originalSubtotalMicros);
    expect(result.discountMicros).toBe(toMicros(1_000));
  });

  it('multiplica por la cantidad de cada linea', () => {
    const result = strategy.apply(ctx({ lines: [line('Tecnologia', 4_550, 3)] }));
    expect(result.baseAmountMicros).toBe(toMicros(13_650));
  });

  it('compara contra el literal, nunca contra la etiqueta con tilde', () => {
    // Si la estrategia comparara contra CATEGORY_LABEL.Tecnologia el descuento
    // no se aplicaria y este test lo detecta.
    expect(CATEGORY_LABEL.Tecnologia).toBe('Tecnología');
    expect(strategy.isApplicable(ctx({ lines: [line('Tecnologia', 100)] }))).toBe(true);
  });

  it('sin lineas Tecnologia no aplica y apply devuelve ceros sin lanzar', () => {
    const c = ctx({ lines: [line('Hogar', 5_000)] });
    expect(strategy.isApplicable(c)).toBe(false);
    expect(strategy.apply(c)).toEqual({
      name: 'CATEGORY', applied: false, rateBps: 0, baseAmountMicros: 0, discountMicros: 0,
    });
  });
});

describe('VolumeDiscount (DE-R1.6, DE-R1.7)', () => {
  const strategy = new VolumeDiscount();

  it('declara name, order y tasa', () => {
    expect([strategy.name, strategy.order, strategy.rateBps]).toEqual(['VOLUME', 2, 500]);
  });

  it('el umbral es ESTRICTAMENTE mayor: 10000 no activa, 10001 si', () => {
    const justo = ctx({ remainingSubtotalMicros: toMicros(VOLUME_THRESHOLD_CENTS) });
    const uno = ctx({ remainingSubtotalMicros: toMicros(VOLUME_THRESHOLD_CENTS + 1) });

    expect(strategy.isApplicable(justo)).toBe(false);
    expect(strategy.apply(justo).discountMicros).toBe(0);
    expect(strategy.apply(justo).applied).toBe(false);

    expect(strategy.isApplicable(uno)).toBe(true);
    const aplicado = strategy.apply(uno);
    expect(aplicado.discountMicros).toBe((aplicado.baseAmountMicros * 500) / 10_000);
  });

  it('compara en micro-centavos sin redondear antes a centavos', () => {
    // Medio centavo por encima del umbral: redondear a centavos lo dejaria en
    // el umbral exacto y no aplicaria.
    const c = ctx({ remainingSubtotalMicros: toMicros(VOLUME_THRESHOLD_CENTS) + 500_000 });
    expect(strategy.isApplicable(c)).toBe(true);
  });

  it('no aplica con remanente 0', () => {
    expect(strategy.isApplicable(ctx({ remainingSubtotalMicros: 0 }))).toBe(false);
  });

  it('la base es el remanente completo, de todas las categorias (DE-R1.7)', () => {
    const c = ctx({
      lines: [line('Tecnologia', 10_000), line('Hogar', 5_000)],
      remainingSubtotalMicros: toMicros(14_000),
    });
    expect(strategy.apply(c).baseAmountMicros).toBe(toMicros(14_000));
  });
});

describe('CouponDiscount (DE-R1.8, DE-R1.9)', () => {
  const strategy = new CouponDiscount();
  const base = toMicros(100_000);

  it('declara name y order', () => {
    expect([strategy.name, strategy.order]).toEqual(['COUPON', 3]);
  });

  it('aplica la tasa del cupon activo sobre el remanente tras VOLUME', () => {
    const coupon = findCouponByCode('WELCOME2026');
    expect(coupon).toBeDefined();
    if (coupon === undefined) return;

    const result = strategy.apply(ctx({ remainingSubtotalMicros: base, coupon }));
    expect(result.rateBps).toBe(1500);
    expect(result.baseAmountMicros).toBe(base);
    expect(result.discountMicros).toBe((base * 1500) / 10_000);
  });

  it('ignora el cupon expirado sin lanzar', () => {
    const coupon = findCouponByCode('SUMMER2024');
    const c = ctx({ remainingSubtotalMicros: base, ...(coupon ? { coupon } : {}) });
    expect(strategy.isApplicable(c)).toBe(false);
    expect(strategy.apply(c).discountMicros).toBe(0);
  });

  it('sin cupon resuelto no aplica y rateBps es 0', () => {
    const c = ctx({ remainingSubtotalMicros: base });
    expect(strategy.isApplicable(c)).toBe(false);
    expect(strategy.apply(c).rateBps).toBe(0);
  });
});

describe('exactitud de las tres estrategias (DE-R1.2)', () => {
  it('discountMicros es siempre base x rateBps / 10000, sin redondear', () => {
    // 5845.5 centavos: valor exacto que NO es multiplo de MICRO. Cualquier
    // redondeo dentro de una estrategia hace fallar esta afirmacion.
    const volume = new VolumeDiscount().apply(
      ctx({ remainingSubtotalMicros: 116_910_000_000 }),
    );
    expect(volume.discountMicros).toBe(5_845_500_000);
    expect(volume.discountMicros % 1_000_000).not.toBe(0);

    const category = new CategoryDiscount().apply(
      ctx({ lines: [line('Tecnologia', 129_900)] }),
    );
    expect(category.discountMicros).toBe(12_990_000_000);

    const coupon = findCouponByCode('WELCOME2026');
    if (coupon === undefined) return;
    const cup = new CouponDiscount().apply(
      ctx({ remainingSubtotalMicros: 111_064_500_000, coupon }),
    );
    expect(cup.discountMicros).toBe(16_659_675_000);
    expect(cup.discountMicros % 1_000_000).not.toBe(0);
  });

  it('no mutan el contexto recibido y son deterministas (DE-R1.10)', () => {
    const c = ctx({ lines: [line('Tecnologia', 10_000)], remainingSubtotalMicros: toMicros(10_000) });
    const snapshot = JSON.stringify(c);
    const s = new CategoryDiscount();
    expect(s.apply(c)).toEqual(s.apply(c));
    expect(JSON.stringify(c)).toBe(snapshot);
  });
});
