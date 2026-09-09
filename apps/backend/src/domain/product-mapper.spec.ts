import { PRODUCT_CATEGORIES } from '@core/shared';

import { CorruptProductRowError, isCorruptProductRowError } from './errors';
import { isProductCategory, toProduct } from './product-mapper';

import type { PersistedProductRow } from './product-mapper';
import type { Product, ProductCategory } from '@core/shared';

/**
 * Invariantes I2 (mapeo fiel y de claves exactas) e I3 (fila corrupta) con tablas de
 * casos fijos. Sin generadores aleatorios: las ramas de `toProduct` son dos.
 *
 * Requisitos: BP-R2.2, BP-R4.5, BP-R4.7, BP-R5.4, BP-R6.3.
 */

/** Las cinco claves del contrato `Product`, en el orden en que las emite el mapper. */
const PRODUCT_KEYS = ['id', 'name', 'category', 'priceCents', 'stock'] as const;

/** Captura el error tipado sin assertions: el guard hace el narrowing (BP-R6.2). */
const catchCorruptRow = (fn: () => unknown): CorruptProductRowError => {
  try {
    fn();
  } catch (error) {
    if (isCorruptProductRowError(error)) return error;
    throw error;
  }
  throw new Error('se esperaba un CorruptProductRowError y no se lanzo ninguno');
};

interface ValidRowCase {
  readonly category: ProductCategory;
  readonly row: PersistedProductRow;
  readonly expected: Product;
}

const TECH_CASE: ValidRowCase = {
  category: 'Tecnologia',
  row: { id: 'PROD-001', name: 'Laptop Pro 14"', category: 'Tecnologia', priceCents: 129900, stock: 5 },
  expected: { id: 'PROD-001', name: 'Laptop Pro 14"', category: 'Tecnologia', priceCents: 129900, stock: 5 },
};

const VALID_ROW_CASES: readonly ValidRowCase[] = [
  TECH_CASE,
  {
    category: 'Hogar',
    row: { id: 'PROD-004', name: 'Lampara de Escritorio', category: 'Hogar', priceCents: 3200, stock: 15 },
    expected: { id: 'PROD-004', name: 'Lampara de Escritorio', category: 'Hogar', priceCents: 3200, stock: 15 },
  },
  {
    category: 'Ropa',
    row: { id: 'PROD-006', name: 'Camiseta Basica', category: 'Ropa', priceCents: 1990, stock: 20 },
    expected: { id: 'PROD-006', name: 'Camiseta Basica', category: 'Ropa', priceCents: 1990, stock: 20 },
  },
];

describe('toProduct: mapeo fiel de fila a Product (I2, BP-R2.2, BP-R4.5, BP-R5.4)', () => {
  it.each([...VALID_ROW_CASES])(
    'mapea una fila de categoria $category con los valores de la fila',
    ({ row, expected }: ValidRowCase) => {
      expect(toProduct(row)).toStrictEqual(expected);
    },
  );

  it.each([...VALID_ROW_CASES])(
    'emite exactamente las cinco claves del contrato para $category',
    ({ row }: ValidRowCase) => {
      expect(Object.keys(toProduct(row))).toStrictEqual([...PRODUCT_KEYS]);
    },
  );

  it('conserva la categoria como literal sin tilde (BP-R5.4)', () => {
    expect(toProduct(TECH_CASE.row).category).toBe('Tecnologia');
  });

  it('devuelve un objeto nuevo, no la fila recibida', () => {
    expect(toProduct(TECH_CASE.row)).not.toBe(TECH_CASE.row);
  });
});

describe('toProduct: no propaga columnas ajenas al contrato (I2, BP-R5.4)', () => {
  /**
   * Fila con columnas de mas: un `...row` en el mapper las filtraria al JSON de la API
   * en silencio. El caso existe para que ese cambio rompa la suite.
   */
  interface WideProductRow extends PersistedProductRow {
    readonly internalNote: string;
    readonly discontinued: boolean;
    readonly legacyPrice: number;
  }

  const wideRow: WideProductRow = {
    id: 'PROD-002',
    name: 'Auriculares Bluetooth',
    category: 'Tecnologia',
    priceCents: 7990,
    stock: 12,
    internalNote: 'columna interna que nunca sale del almacen',
    discontinued: false,
    legacyPrice: 9999,
  };

  it('mapea los cinco campos del contrato y descarta el resto', () => {
    expect(toProduct(wideRow)).toStrictEqual({
      id: 'PROD-002',
      name: 'Auriculares Bluetooth',
      category: 'Tecnologia',
      priceCents: 7990,
      stock: 12,
    });
  });

  it.each(['internalNote', 'discontinued', 'legacyPrice'])(
    'la columna extra %s no aparece en el resultado',
    (extraKey: string) => {
      expect(Object.keys(toProduct(wideRow))).not.toContain(extraKey);
      expect(extraKey in toProduct(wideRow)).toBe(false);
    },
  );

  it('la serializacion JSON tampoco incluye las columnas extra', () => {
    // Se afirma sobre el texto serializado, no sobre `JSON.parse`, que devuelve `any`.
    expect(JSON.stringify(toProduct(wideRow))).toBe(
      '{"id":"PROD-002","name":"Auriculares Bluetooth","category":"Tecnologia","priceCents":7990,"stock":12}',
    );
  });
});

describe('toProduct: fila corrupta (I3, BP-R4.7)', () => {
  /** La primera es la trampa de la tilde: solo difiere de `'Tecnologia'` en un acento. */
  const CORRUPT_CATEGORIES = ['Tecnología', 'TECNOLOGIA', ''] as const;

  const corruptRow = (category: string): PersistedProductRow => ({
    id: 'PROD-777',
    name: 'Fila corrupta',
    category,
    priceCents: 1000,
    stock: 1,
  });

  it.each([...CORRUPT_CATEGORIES])(
    'la categoria %p lanza CorruptProductRowError con el id y el valor invalido',
    (category: string) => {
      const error = catchCorruptRow(() => toProduct(corruptRow(category)));

      expect(error).toBeInstanceOf(CorruptProductRowError);
      expect(error.name).toBe('CorruptProductRowError');
      expect(error.productId).toBe('PROD-777');
      expect(error.invalidCategory).toBe(category);
    },
  );

  it.each([...CORRUPT_CATEGORIES])(
    'el mensaje de %p nombra la fila y las categorias validas',
    (category: string) => {
      const error = catchCorruptRow(() => toProduct(corruptRow(category)));

      expect(error.message).toContain('PROD-777');
      expect(error.message).toContain(PRODUCT_CATEGORIES.join(' | '));
    },
  );

  it('nunca devuelve un Product para una fila corrupta', () => {
    let mapped: Product | undefined = undefined;
    try {
      mapped = toProduct(corruptRow('Tecnología'));
    } catch (error) {
      expect(isCorruptProductRowError(error)).toBe(true);
    }
    expect(mapped).toBeUndefined();
  });
});

describe('isProductCategory: guard contra PRODUCT_CATEGORIES', () => {
  it.each([...PRODUCT_CATEGORIES])('acepta el literal %s', (category: ProductCategory) => {
    expect(isProductCategory(category)).toBe(true);
  });

  it.each(['Tecnología', 'TECNOLOGIA', '', 'hogar', 'Deportes'])(
    'rechaza %p',
    (category: string) => {
      expect(isProductCategory(category)).toBe(false);
    },
  );
});
