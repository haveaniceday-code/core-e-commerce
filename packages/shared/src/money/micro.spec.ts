import { describe, expect, it } from 'vitest';
import { applyBps, MAX_SUBTOTAL_CENTS, MICRO, roundHalfUp, toMicros } from './micro';

describe('escala de micro-centavos (SCS-R3.1)', () => {
  it('MICRO es el entero 1.000.000', () => {
    expect(MICRO).toBe(1_000_000);
    expect(Number.isInteger(MICRO)).toBe(true);
  });

  it('toMicros escala centavos a micro-centavos enteros', () => {
    expect(toMicros(0)).toBe(0);
    expect(toMicros(1)).toBe(1_000_000);
    expect(toMicros(129900)).toBe(129_900_000_000);
  });

  it('la cota de la escala se mantiene dentro de MAX_SAFE_INTEGER', () => {
    expect(toMicros(MAX_SUBTOTAL_CENTS)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });
});

describe('roundHalfUp (SCS-R3.2)', () => {
  it('devuelve el entero de centavos mas cercano', () => {
    expect(roundHalfUp(0)).toBe(0);
    expect(roundHalfUp(12_990_000_000)).toBe(12990);
    expect(roundHalfUp(16_659_675_000)).toBe(16660);
    expect(roundHalfUp(35_495_175_000)).toBe(35495);
  });

  it('resuelve el empate exacto de .5 hacia arriba', () => {
    expect(roundHalfUp(5_845_500_000)).toBe(5846);
    expect(roundHalfUp(18_835_500_000)).toBe(18836);
  });

  it('siempre devuelve un entero', () => {
    for (const micros of [1, 499_999, 500_000, 500_001, 35_495_175_000]) {
      expect(Number.isInteger(roundHalfUp(micros))).toBe(true);
    }
  });
});

describe('applyBps (SCS-R3.3)', () => {
  it('aplica la tasa como x bps / 10000', () => {
    expect(applyBps(129_900_000_000, 1000)).toBe(12_990_000_000);
    expect(applyBps(116_910_000_000, 500)).toBe(5_845_500_000);
    expect(applyBps(111_064_500_000, 1500)).toBe(16_659_675_000);
  });

  it('da entero exacto en toda la cascada de produccion', () => {
    // Los denominadores acumulados (10, 20, 20) multiplican 4000, que divide a MICRO.
    let remaining = toMicros(129900);
    for (const bps of [1000, 500, 1500]) {
      const discount = applyBps(remaining, bps);
      expect(Number.isInteger(discount)).toBe(true);
      remaining -= discount;
      expect(Number.isInteger(remaining)).toBe(true);
    }
  });

  it('una tasa de 0 bps no descuenta nada', () => {
    expect(applyBps(129_900_000_000, 0)).toBe(0);
  });
});
