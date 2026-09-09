import { CATALOG_PRODUCTS } from '@core/shared';

import { seedProducts } from '../prisma/seed';

import type { Product } from '@core/shared';
import type { ProductUpsertArgs, ProductUpsertClient } from '../prisma/seed';
import type { PersistedProductRow } from '../src/domain/product-mapper';

/**
 * Almacen doble de la tabla `Product`, completamente tipado: cero `any`, cero
 * assertions, cero `@ts-ignore`. `implements ProductUpsertClient` hace que el compilador
 * verifique que el doble y el `PrismaClient` real hablan la misma interfaz; si la firma
 * del seed cambia, este archivo deja de compilar.
 *
 * Reproduce la semantica de `upsert` que importa para el invariante: clave primaria `id`,
 * `create` cuando la fila no existe, `update` cuando existe, y ninguna insercion
 * duplicada. Guarda las filas en un `Map` por `id`, que es lo que hace estructuralmente
 * imposible el duplicado, igual que la PK en SQLite.
 */
class InMemoryProductStore implements ProductUpsertClient {
  private readonly rows = new Map<string, PersistedProductRow>();

  public upsertCalls = 0;
  public createCalls = 0;
  public updateCalls = 0;

  public readonly product = {
    upsert: (args: ProductUpsertArgs): Promise<PersistedProductRow> => {
      this.upsertCalls += 1;
      const existing = this.rows.get(args.where.id);
      let row: PersistedProductRow;
      if (existing === undefined) {
        this.createCalls += 1;
        row = {
          id: args.create.id,
          name: args.create.name,
          category: args.create.category,
          priceCents: args.create.priceCents,
          stock: args.create.stock,
        };
      } else {
        this.updateCalls += 1;
        // `update` no reasigna la PK: la fila conserva su `id`, como en la tabla real.
        row = {
          id: existing.id,
          name: args.update.name,
          category: args.update.category,
          priceCents: args.update.priceCents,
          stock: args.update.stock,
        };
      }
      this.rows.set(row.id, row);
      return Promise.resolve(row);
    },
  };

  constructor(initialRows: readonly PersistedProductRow[] = []) {
    for (const row of initialRows) {
      this.rows.set(row.id, row);
    }
  }

  /** Filas resultantes en orden ascendente por `id`, el mismo de `CATALOG_PRODUCTS`. */
  public snapshot(): readonly PersistedProductRow[] {
    return [...this.rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

/** Estado inicial "sucio": stock consumido por checkouts previos, uno de ellos a cero. */
const DECREMENTED_ROWS: readonly PersistedProductRow[] = [
  { id: 'PROD-001', name: 'Laptop Pro 14"', category: 'Tecnologia', priceCents: 129900, stock: 1 },
  { id: 'PROD-005', name: 'Juego de Sábanas', category: 'Hogar', priceCents: 5900, stock: 0 },
];

describe('seedProducts (invariante I9: idempotencia)', () => {
  describe('desde un almacen vacio', () => {
    it('deja exactamente CATALOG_PRODUCTS tras dos ejecuciones consecutivas, sin duplicados', async () => {
      const store = new InMemoryProductStore();

      const firstWritten = await seedProducts(store);
      const afterFirst = store.snapshot();
      const secondWritten = await seedProducts(store);
      const afterSecond = store.snapshot();

      expect(firstWritten).toBe(CATALOG_PRODUCTS.length);
      expect(secondWritten).toBe(CATALOG_PRODUCTS.length);
      expect(afterFirst).toStrictEqual(CATALOG_PRODUCTS);
      expect(afterSecond).toStrictEqual(CATALOG_PRODUCTS);
      // Sin duplicados: seis filas y seis ids distintos, no doce.
      expect(afterSecond).toHaveLength(6);
      expect(new Set(afterSecond.map((row) => row.id)).size).toBe(6);
    });

    it('inserta en la primera pasada y actualiza en la segunda, con una escritura por producto', async () => {
      const store = new InMemoryProductStore();

      await seedProducts(store);
      expect(store.createCalls).toBe(CATALOG_PRODUCTS.length);
      expect(store.updateCalls).toBe(0);

      await seedProducts(store);
      expect(store.createCalls).toBe(CATALOG_PRODUCTS.length);
      expect(store.updateCalls).toBe(CATALOG_PRODUCTS.length);
      expect(store.upsertCalls).toBe(CATALOG_PRODUCTS.length * 2);
    });
  });

  describe('desde un almacen con stock decrementado', () => {
    it('restablece el catalogo canonico tras dos ejecuciones consecutivas', async () => {
      const store = new InMemoryProductStore(DECREMENTED_ROWS);

      await seedProducts(store);
      const afterFirst = store.snapshot();
      await seedProducts(store);
      const afterSecond = store.snapshot();

      expect(afterFirst).toStrictEqual(CATALOG_PRODUCTS);
      expect(afterSecond).toStrictEqual(CATALOG_PRODUCTS);
      expect(afterSecond).toHaveLength(6);
    });

    it('reescribe el stock de las filas existentes en lugar de conservarlo', async () => {
      const store = new InMemoryProductStore(DECREMENTED_ROWS);

      await seedProducts(store);
      const rows = store.snapshot();

      expect(rows.find((row) => row.id === 'PROD-001')?.stock).toBe(5);
      expect(rows.find((row) => row.id === 'PROD-005')?.stock).toBe(3);
      // Las dos filas preexistentes se actualizan; las cuatro restantes se crean.
      expect(store.updateCalls).toBe(2);
      expect(store.createCalls).toBe(4);
    });
  });

  describe('con una lista de productos explicita', () => {
    it('escribe solo los productos recibidos y devuelve su cantidad', async () => {
      const store = new InMemoryProductStore();
      const subset: readonly Product[] = [
        { id: 'PROD-004', name: 'Lámpara de Escritorio', category: 'Hogar', priceCents: 3200, stock: 15 },
      ];

      const written = await seedProducts(store, subset);
      await seedProducts(store, subset);

      expect(written).toBe(1);
      expect(store.snapshot()).toStrictEqual(subset);
    });

    it('no escribe nada ni falla con una lista vacia', async () => {
      const store = new InMemoryProductStore();

      const written = await seedProducts(store, []);

      expect(written).toBe(0);
      expect(store.upsertCalls).toBe(0);
      expect(store.snapshot()).toStrictEqual([]);
    });
  });

  it('toma la categoria del literal sin tilde del catalogo compartido', async () => {
    const store = new InMemoryProductStore();

    await seedProducts(store);

    expect(store.snapshot().map((row) => row.category)).toStrictEqual([
      'Tecnologia',
      'Tecnologia',
      'Tecnologia',
      'Hogar',
      'Hogar',
      'Ropa',
    ]);
  });
});
