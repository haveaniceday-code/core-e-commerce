/**
 * Reglas puras de stock (BC-R4.1, BC-R4.2, BC-R4.3, BC-R6.6).
 *
 * Vive en `domain` y no en `application` por la misma razon que `product-mapper.ts`:
 * son funciones puras sobre tipos estructurales, se prueban sin contenedor y quedan
 * dentro de la medicion de cobertura. Sin Prisma, sin NestJS y sin HTTP; la regla
 * `no-restricted-imports` acotada a `src/domain/**` lo verifica en el lint.
 */
import { DiscountDomainError } from '@core/shared';

import type { CartItem, Product, StockShortage } from '@core/shared';

/**
 * Exigencia de stock de un producto distinto: cuanto se pide en total y cuanto hay
 * segun el catalogo leido. `requested` es la SUMA de todas las lineas del carrito
 * que apuntan a ese producto.
 */
export interface StockRequirement {
  readonly productId: string;
  readonly requested: number;
  readonly available: number;
}

/**
 * Resultado de una actualizacion condicional de stock (compare-and-swap). El
 * adaptador la produce con las filas afectadas que devuelve el motor; el dominio
 * solo la interpreta.
 */
export interface StockDecrementOutcome {
  readonly productId: string;
  readonly requested: number;
  readonly affectedRows: number;
}

/**
 * Suma las cantidades por producto: dos lineas del mismo producto son una sola
 * exigencia (BC-R4.1). Evaluarlas por separado dejaria pasar un carrito que pide
 * 2 + 2 unidades de un producto con stock 3.
 *
 * El orden de salida es el de primera aparicion en el carrito, que `Map` conserva:
 * asi la lista es determinista sin necesidad de ordenarla aqui.
 *
 * Una linea cuyo producto no esta en el catalogo NO produce exigencia. No es un
 * descarte silencioso de un caso posible: la secuencia de `confirm` valida el
 * carrito con el motor antes de mirar el stock (BC-R4.5), asi que un producto
 * inexistente ya fallo con `PRODUCT_NOT_FOUND`. Inventarle `available: 0` lo
 * convertiria en un deficit de stock y responderia `409` donde corresponde `404`.
 */
export const normalizeCart = (
  items: readonly CartItem[],
  catalog: readonly Product[],
): readonly StockRequirement[] => {
  const requestedByProduct = new Map<string, number>();
  for (const item of items) {
    const accumulated = requestedByProduct.get(item.productId) ?? 0;
    requestedByProduct.set(item.productId, accumulated + item.quantity);
  }

  const requirements: StockRequirement[] = [];
  for (const [productId, requested] of requestedByProduct) {
    const product = catalog.find((candidate) => candidate.id === productId);
    if (product === undefined) {
      continue;
    }
    requirements.push({ productId, requested, available: product.stock });
  }
  return requirements;
};

/**
 * Exigencias deficitarias, en orden ascendente por `productId` para que la respuesta
 * sea determinista (BC-R4.3). Reporta TODAS, no solo la primera: es una divergencia
 * deliberada del fail-fast de `resolveCart`, para que el usuario corrija el carrito
 * en un solo intento.
 */
export const findShortages = (
  requirements: readonly StockRequirement[],
): readonly StockShortage[] =>
  requirements
    // Estrictamente mayor: una cantidad IGUAL al stock esta satisfecha (BC-R4.2).
    .filter((requirement) => requirement.requested > requirement.available)
    .map(({ productId, requested, available }) => ({ productId, requested, available }))
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));

/**
 * Guarda del compare-and-swap (BC-R6.6). Lanza si alguna actualizacion condicional
 * no afecto fila, lo que significa que el stock dejo de ser suficiente entre la
 * validacion y la escritura. Lanzar dentro de la transaccion la aborta entera.
 *
 * Existe como funcion aparte del adaptador por una razon concreta: alli no podria
 * probarse sin doblar el cliente transaccional, y quedaria fuera de la medicion de
 * cobertura.
 *
 * No reporta `available`: el compare-and-swap sabe que la fila ya no cumplia la
 * condicion, pero no cuanto stock quedaba, y releerlo daria un valor igual de
 * obsoleto. Por eso sus detalles son `contendedProductIds` y no `shortages`.
 */
export const verifyStockDecrements = (outcomes: readonly StockDecrementOutcome[]): void => {
  const contendedProductIds = outcomes
    .filter((outcome) => outcome.affectedRows === 0)
    .map((outcome) => outcome.productId);

  if (contendedProductIds.length === 0) {
    return;
  }

  throw new DiscountDomainError(
    'INSUFFICIENT_STOCK',
    'El stock cambio mientras se confirmaba la compra.',
    { contendedProductIds },
  );
};
