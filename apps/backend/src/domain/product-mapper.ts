import { PRODUCT_CATEGORIES } from '@core/shared';

import { CorruptProductRowError } from './errors';

import type { Product, ProductCategory } from '@core/shared';

/**
 * Forma estructural de una fila persistida. Deliberadamente NO es un tipo de Prisma:
 * el modelo generado la satisface estructuralmente, asi que el adaptador puede pasarla
 * sin conversion, y el dominio no importa `@prisma/client` (BP-R4.3).
 */
export interface PersistedProductRow {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly priceCents: number;
  readonly stock: number;
}

/**
 * `.some(...)` y no `.includes(...)`: `includes` sobre un `readonly ProductCategory[]`
 * exige un argumento ya estrechado, lo que obligaria a una assertion. La comparacion
 * `===` entre el literal y el `string` es legal y el predicado hace el narrowing.
 */
export const isProductCategory = (value: string): value is ProductCategory =>
  PRODUCT_CATEGORIES.some((category) => category === value);

/**
 * Mapea fila -> Product enumerando las cinco claves una por una. No usa spread:
 * un `...row` propagaria cualquier columna futura al JSON de la API y romperia
 * BP-R5.3 en silencio.
 */
export const toProduct = (row: PersistedProductRow): Product => {
  if (!isProductCategory(row.category)) {
    throw new CorruptProductRowError(row.id, row.category);
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category, // ya estrechado por el guard
    priceCents: row.priceCents,
    stock: row.stock,
  };
};
