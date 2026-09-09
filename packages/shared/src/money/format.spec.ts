import { describe, expect, it } from 'vitest';
import { formatCents } from './format';

describe('formatCents (SCS-R3.4)', () => {
  it('formatea los montos del criterio', () => {
    expect(formatCents(129900)).toBe('$1,299.00');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(1990)).toBe('$19.90');
    expect(formatCents(100000000)).toBe('$1,000,000.00');
  });

  it('rellena los decimales a dos digitos', () => {
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(50)).toBe('$0.50');
    expect(formatCents(105)).toBe('$1.05');
  });

  it('formatea todos los precios del catalogo', () => {
    expect(formatCents(7990)).toBe('$79.90');
    expect(formatCents(4550)).toBe('$45.50');
    expect(formatCents(3200)).toBe('$32.00');
    expect(formatCents(5900)).toBe('$59.00');
  });
});
