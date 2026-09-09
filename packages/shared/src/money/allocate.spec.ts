import { describe, expect, it } from 'vitest';
import { allocateByLargestRemainder } from './allocate';
import { MICRO } from './micro';

describe('reparto por mayor resto (SCS-R3.5 - SCS-R3.7)', () => {
  it('reparte el fixture canonico y suma exactamente el objetivo', () => {
    const lines = [12_990_000_000, 5_845_500_000, 16_659_675_000];
    const result = allocateByLargestRemainder(lines, 35495);

    // Los pisos suman 35494; el centavo sobrante va a COUPON por su resto .675.
    expect(result).toEqual([12990, 5845, 16660]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(35495);
  });

  it('ante restos iguales asigna a la posicion de menor indice', () => {
    // Dos posiciones con resto .5 y un solo centavo que repartir.
    const result = allocateByLargestRemainder([1_500_000, 2_500_000], 4);
    expect(result).toEqual([2, 2]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('no muta la lista de entrada', () => {
    const input = [1_500_000, 2_500_000];
    const copy = [...input];
    allocateByLargestRemainder(input, 4);
    expect(input).toEqual(copy);
  });

  it('devuelve lista vacia con objetivo 0 y sin lanzar', () => {
    expect(allocateByLargestRemainder([], 0)).toEqual([]);
  });

  it('devuelve los pisos cuando no hay sobrante que repartir', () => {
    expect(allocateByLargestRemainder([2 * MICRO, 3 * MICRO], 5)).toEqual([2, 3]);
  });

  it('conserva longitud y orden, y devuelve enteros', () => {
    const lines = [12_990_000_000, 5_845_500_000, 16_659_675_000];
    const result = allocateByLargestRemainder(lines, 35495);
    expect(result).toHaveLength(lines.length);
    expect(result.every((c) => Number.isInteger(c) && c >= 0)).toBe(true);
  });
});
