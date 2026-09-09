import { CATALOG_PRODUCTS, DiscountDomainError, isDiscountDomainError } from '@core/shared';

import { findShortages, normalizeCart, verifyStockDecrements } from './stock';

import type { StockDecrementOutcome, StockRequirement } from './stock';
import type { CartItem, Product, StockShortage } from '@core/shared';

/**
 * Reglas puras de stock con tablas de casos fijos: sin generadores y sin aleatoriedad.
 * Las ramas de las tres funciones son contables a mano, y el valor de cada caso esta
 * en que su resultado se verifica leyendo el catalogo canonico.
 *
 * Requisitos: BC-R8.3 (frontera de PROD-005 con stock 3), BC-R8.9 (la guarda del
 * compare-and-swap).
 */

/** Subconjunto del catalogo canonico, para no reescribir precios ni stocks a mano. */
const catalogOf = (...ids: readonly string[]): readonly Product[] =>
  ids.map((id) => {
    const product = CATALOG_PRODUCTS.find((candidate) => candidate.id === id);
    if (product === undefined) {
      throw new Error(`el catalogo canonico no tiene ${id}: revisa el fixture`);
    }
    return product;
  });

const item = (productId: string, quantity: number): CartItem => ({ productId, quantity });

const requirement = (
  productId: string,
  requested: number,
  available: number,
): StockRequirement => ({ productId, requested, available });

const outcome = (
  productId: string,
  requested: number,
  affectedRows: number,
): StockDecrementOutcome => ({ productId, requested, affectedRows });

/** Captura el error tipado sin assertions: el guard hace el narrowing. */
const catchDomainError = (fn: () => unknown): DiscountDomainError => {
  try {
    fn();
  } catch (error) {
    if (isDiscountDomainError(error)) return error;
    throw error;
  }
  throw new Error('se esperaba un DiscountDomainError y no se lanzo ninguno');
};

describe('normalizeCart: una exigencia por producto distinto (BC-R4.1)', () => {
  interface NormalizeCase {
    readonly scenario: string;
    readonly items: readonly CartItem[];
    readonly catalog: readonly Product[];
    readonly expected: readonly StockRequirement[];
  }

  const CASES: readonly NormalizeCase[] = [
    {
      scenario: 'una sola linea',
      items: [item('PROD-001', 2)],
      catalog: catalogOf('PROD-001'),
      expected: [requirement('PROD-001', 2, 5)],
    },
    {
      // 2 + 2 = 4 sobre un stock de 3: evaluadas por separado, ambas lineas pasarian.
      scenario: 'dos lineas del mismo producto se suman en una exigencia',
      items: [item('PROD-005', 2), item('PROD-005', 2)],
      catalog: catalogOf('PROD-005'),
      expected: [requirement('PROD-005', 4, 3)],
    },
    {
      scenario: 'tres lineas, dos productos distintos, en orden de primera aparicion',
      items: [item('PROD-006', 1), item('PROD-001', 1), item('PROD-006', 4)],
      catalog: catalogOf('PROD-001', 'PROD-006'),
      expected: [requirement('PROD-006', 5, 20), requirement('PROD-001', 1, 5)],
    },
    {
      // Catalogo vacio: no hay exigencias que emitir. Un producto ausente NO se
      // convierte en `available: 0`, porque eso volveria un 404 en un 409.
      scenario: 'catalogo vacio no produce exigencias',
      items: [item('PROD-001', 1), item('PROD-002', 3)],
      catalog: [],
      expected: [],
    },
    {
      scenario: 'la linea de un producto ausente del catalogo se omite',
      items: [item('PROD-001', 1), item('PROD-999', 7)],
      catalog: catalogOf('PROD-001'),
      expected: [requirement('PROD-001', 1, 5)],
    },
    {
      scenario: 'carrito vacio no produce exigencias',
      items: [],
      catalog: catalogOf('PROD-001'),
      expected: [],
    },
  ];

  it.each([...CASES])('$scenario', ({ items, catalog, expected }: NormalizeCase) => {
    expect(normalizeCart(items, catalog)).toStrictEqual([...expected]);
  });

  it('no muta el carrito recibido', () => {
    const items: readonly CartItem[] = [item('PROD-005', 2), item('PROD-005', 1)];

    normalizeCart(items, catalogOf('PROD-005'));

    expect(items).toStrictEqual([
      { productId: 'PROD-005', quantity: 2 },
      { productId: 'PROD-005', quantity: 1 },
    ]);
  });
});

describe('findShortages: deficit estricto y orden determinista (BC-R4.2, BC-R4.3)', () => {
  interface ShortageCase {
    readonly scenario: string;
    readonly requirements: readonly StockRequirement[];
    readonly expected: readonly StockShortage[];
  }

  const CASES: readonly ShortageCase[] = [
    {
      scenario: 'sin deficit devuelve lista vacia',
      requirements: [requirement('PROD-001', 2, 5), requirement('PROD-006', 1, 20)],
      expected: [],
    },
    {
      // BC-R8.3: la cantidad IGUAL al stock de PROD-005 esta satisfecha.
      scenario: 'cantidad igual al stock no es deficit',
      requirements: [requirement('PROD-005', 3, 3)],
      expected: [],
    },
    {
      // BC-R8.3: una unidad mas sobre el mismo stock si lo es.
      scenario: 'una unidad por encima del stock es deficit',
      requirements: [requirement('PROD-005', 4, 3)],
      expected: [{ productId: 'PROD-005', requested: 4, available: 3 }],
    },
    {
      scenario: 'un deficit entre exigencias satisfechas se reporta solo',
      requirements: [
        requirement('PROD-001', 1, 5),
        requirement('PROD-005', 9, 3),
        requirement('PROD-006', 20, 20),
      ],
      expected: [{ productId: 'PROD-005', requested: 9, available: 3 }],
    },
    {
      scenario: 'dos deficits salen ascendentes por productId aunque entren al reves',
      requirements: [requirement('PROD-005', 4, 3), requirement('PROD-001', 6, 5)],
      expected: [
        { productId: 'PROD-001', requested: 6, available: 5 },
        { productId: 'PROD-005', requested: 4, available: 3 },
      ],
    },
    {
      scenario: 'lista vacia de exigencias devuelve lista vacia',
      requirements: [],
      expected: [],
    },
  ];

  it.each([...CASES])('$scenario', ({ requirements, expected }: ShortageCase) => {
    expect(findShortages(requirements)).toStrictEqual([...expected]);
  });

  it('reporta todos los deficits, no solo el primero', () => {
    const shortages = findShortages([
      requirement('PROD-006', 21, 20),
      requirement('PROD-001', 6, 5),
      requirement('PROD-005', 4, 3),
    ]);

    expect(shortages.map((shortage) => shortage.productId)).toStrictEqual([
      'PROD-001',
      'PROD-005',
      'PROD-006',
    ]);
  });

  it('conserva el orden relativo cuando dos exigencias comparten productId', () => {
    // El comparador tiene una rama para la igualdad de ids; este caso la ejercita.
    expect(
      findShortages([requirement('PROD-005', 4, 3), requirement('PROD-005', 5, 3)]),
    ).toStrictEqual([
      { productId: 'PROD-005', requested: 4, available: 3 },
      { productId: 'PROD-005', requested: 5, available: 3 },
    ]);
  });

  it('no muta ni reordena las exigencias recibidas', () => {
    const requirements: readonly StockRequirement[] = [
      requirement('PROD-005', 4, 3),
      requirement('PROD-001', 6, 5),
    ];

    findShortages(requirements);

    expect(requirements.map((r) => r.productId)).toStrictEqual(['PROD-005', 'PROD-001']);
  });

  it('emite exactamente las tres claves del contrato StockShortage', () => {
    const [shortage] = findShortages([requirement('PROD-005', 4, 3)]);

    expect(Object.keys(shortage ?? {})).toStrictEqual(['productId', 'requested', 'available']);
  });
});

describe('verifyStockDecrements: guarda del compare-and-swap (BC-R6.6, BC-R8.9)', () => {
  it.each([
    { scenario: 'sin actualizaciones', outcomes: [] },
    { scenario: 'una sola que afecto fila', outcomes: [outcome('PROD-001', 2, 1)] },
    {
      scenario: 'todas afectaron fila',
      outcomes: [outcome('PROD-001', 2, 1), outcome('PROD-005', 3, 1), outcome('PROD-006', 1, 1)],
    },
  ])('no lanza: $scenario', ({ outcomes }: { readonly outcomes: readonly StockDecrementOutcome[] }) => {
    expect(() => verifyStockDecrements(outcomes)).not.toThrow();
  });

  it('lanza INSUFFICIENT_STOCK cuando una actualizacion no afecto fila', () => {
    const error = catchDomainError(() =>
      verifyStockDecrements([outcome('PROD-001', 2, 1), outcome('PROD-005', 3, 0)]),
    );

    expect(error).toBeInstanceOf(DiscountDomainError);
    expect(error.name).toBe('DiscountDomainError');
    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.details).toStrictEqual({ contendedProductIds: ['PROD-005'] });
  });

  it('reporta todos los productos en contienda, en el orden de las actualizaciones', () => {
    const error = catchDomainError(() =>
      verifyStockDecrements([
        outcome('PROD-005', 3, 0),
        outcome('PROD-001', 2, 1),
        outcome('PROD-006', 4, 0),
      ]),
    );

    expect(error.details).toStrictEqual({ contendedProductIds: ['PROD-005', 'PROD-006'] });
  });

  it('no reporta `available`: el compare-and-swap no lo conoce', () => {
    const error = catchDomainError(() => verifyStockDecrements([outcome('PROD-005', 3, 0)]));

    expect(error.toApiError()).toStrictEqual({
      error: {
        code: 'INSUFFICIENT_STOCK',
        message: 'El stock cambio mientras se confirmaba la compra.',
        details: { contendedProductIds: ['PROD-005'] },
      },
    });
  });
});
