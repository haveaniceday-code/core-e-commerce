import { CATALOG_PRODUCTS } from '@core/shared';

import { compareProductId, sortByProductId } from './product-order';

import type { Product } from '@core/shared';

/**
 * Invariante I5: el catalogo sale ordenado ascendentemente por `id` sin mutar la entrada,
 * de modo que dos peticiones consecutivas produzcan el mismo arreglo.
 *
 * Requisitos: BP-R5.5, BP-R6.3.
 */

const product = (id: string): Product => ({
  id,
  name: `Producto ${id}`,
  category: 'Ropa',
  priceCents: 1000,
  stock: 1,
});

const ids = (products: readonly Product[]): readonly string[] => products.map((p) => p.id);

describe('sortByProductId: casos de tamano (I5, BP-R5.5)', () => {
  it('catalogo vacio devuelve un arreglo vacio, sin lanzar', () => {
    expect(sortByProductId([])).toStrictEqual([]);
  });

  it('un solo producto devuelve ese producto', () => {
    const single = [product('PROD-003')];

    expect(sortByProductId(single)).toStrictEqual(single);
  });

  it('entrada desordenada sale ascendente por id', () => {
    const unsorted = [
      product('PROD-005'),
      product('PROD-001'),
      product('PROD-006'),
      product('PROD-002'),
      product('PROD-004'),
      product('PROD-003'),
    ];

    expect(ids(sortByProductId(unsorted))).toStrictEqual([
      'PROD-001',
      'PROD-002',
      'PROD-003',
      'PROD-004',
      'PROD-005',
      'PROD-006',
    ]);
  });

  it('entrada ya ordenada se conserva igual', () => {
    const sorted = [product('PROD-001'), product('PROD-002'), product('PROD-003')];

    expect(sortByProductId(sorted)).toStrictEqual(sorted);
  });

  it('el catalogo del seed invertido vuelve al orden canonico', () => {
    const reversed = [...CATALOG_PRODUCTS].reverse();

    expect(ids(sortByProductId(reversed))).toStrictEqual(ids(CATALOG_PRODUCTS));
  });
});

describe('sortByProductId: no muta la entrada (I5)', () => {
  it('deja el arreglo recibido intacto', () => {
    const unsorted = [product('PROD-005'), product('PROD-001'), product('PROD-003')];
    const before = ids(unsorted);

    sortByProductId(unsorted);

    expect(ids(unsorted)).toStrictEqual(before);
    expect(before).toStrictEqual(['PROD-005', 'PROD-001', 'PROD-003']);
  });

  it('devuelve un arreglo nuevo, no la misma referencia', () => {
    const input = [product('PROD-002'), product('PROD-001')];

    expect(sortByProductId(input)).not.toBe(input);
  });

  it('dos llamadas consecutivas producen el mismo orden', () => {
    const unsorted = [product('PROD-006'), product('PROD-002'), product('PROD-004')];

    expect(sortByProductId(unsorted)).toStrictEqual(sortByProductId(unsorted));
  });
});

interface CompareCase {
  readonly a: string;
  readonly b: string;
  readonly expected: number;
}

/** El comparador devuelve exactamente -1, 1 o 0: no delega en `localeCompare`. */
const COMPARE_CASES: readonly CompareCase[] = [
  { a: 'PROD-001', b: 'PROD-002', expected: -1 },
  { a: 'PROD-002', b: 'PROD-001', expected: 1 },
  { a: 'PROD-001', b: 'PROD-001', expected: 0 },
  { a: 'PROD-002', b: 'PROD-010', expected: -1 },
  { a: '', b: 'PROD-001', expected: -1 },
];

describe('compareProductId', () => {
  it.each([...COMPARE_CASES])(
    'compara $a con $b y devuelve $expected',
    ({ a, b, expected }: CompareCase) => {
      expect(compareProductId(product(a), product(b))).toBe(expected);
    },
  );
});
