import {
  ApiClientError,
  GENERIC_ERROR_MESSAGE,
  apiErrorFrom,
  isProductCategory,
  isRecord,
  readJsonBody,
} from './http';

import type { Product } from '@core/shared';

/**
 * Cliente de la API del catalogo.
 *
 * Junto con `checkout.api.ts` es uno de los dos unicos puntos de la app que invocan
 * `fetch` (FC-R2.1). Ni los componentes ni el store conocen rutas, verbos ni codigos de
 * estado: reciben `Product[]` o un `ApiClientError` con un mensaje ya presentable.
 *
 * El error tipado y las guardas de respuesta —`ApiClientError`, `isRecord`, la lectura
 * del cuerpo y la traduccion de un estado no `ok` a error— viven en `http.ts` desde que
 * el checkout las necesita tambien (FK-R1.4), junto con `isProductCategory`, que ahora
 * tambien estrecha la categoria de las lineas de la orden confirmada. Aqui queda solo lo
 * propio del catalogo: la ruta y la guarda de `Product`, que nadie mas consume.
 *
 * El narrowing sigue viviendo en este unico punto de entrada, igual que `toProduct` en
 * el backend con las filas de Prisma: hacia dentro todo esta tipado.
 */

const CATALOG_URL = '/api/products';

/**
 * Valida la forma estructural de `Product`. No valida rangos (entero, no negativo):
 * eso lo garantiza el seed y lo revalida el motor. Aqui solo se comprueba lo que el
 * tipo promete, que es lo que el resto de la app dara por cierto.
 */
const isProduct = (value: unknown): value is Product =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  typeof value.name === 'string' &&
  isProductCategory(value.category) &&
  typeof value.priceCents === 'number' &&
  typeof value.stock === 'number';

const isCatalog = (value: unknown): value is readonly Product[] =>
  Array.isArray(value) && value.every((entry: unknown) => isProduct(entry));

/**
 * Pide el catalogo a `GET /api/products` y lo devuelve tipado con el `Product` de
 * `@core/shared`, sin redeclarar su forma (FC-R2.2).
 *
 * Fallo de red y respuesta no satisfactoria producen el mismo error tipado: quien
 * llama distingue exito de fallo, no la causa del fallo, porque la pantalla hace lo
 * mismo en ambos casos (FC-R2.3).
 *
 * @throws {ApiClientError} red caida, estado no `ok`, o cuerpo que no es un catalogo.
 */
export const fetchCatalog = async (): Promise<readonly Product[]> => {
  let response: Response;
  try {
    response = await fetch(CATALOG_URL);
  } catch {
    // `fetch` solo rechaza por fallo de red; un `500` es una promesa resuelta.
    throw new ApiClientError(GENERIC_ERROR_MESSAGE);
  }

  if (!response.ok) {
    throw await apiErrorFrom(response);
  }

  const body = await readJsonBody(response);

  if (!isCatalog(body)) {
    throw new ApiClientError(GENERIC_ERROR_MESSAGE);
  }

  return body;
};
