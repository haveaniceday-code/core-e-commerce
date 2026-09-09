import { PRODUCT_CATEGORIES } from '@core/shared';

import type { ApiError, Product, ProductCategory } from '@core/shared';

/**
 * Cliente de la API del catalogo.
 *
 * Este archivo es el UNICO punto de la app que invoca `fetch` (FC-R2.1). Ni los
 * componentes ni el store conocen rutas, verbos ni codigos de estado: reciben
 * `Product[]` o un `ApiClientError` con un mensaje ya presentable.
 *
 * ## La frontera de red y la assertion que no se escribe
 *
 * `Response.json()` devuelve `Promise<any>`, y el proyecto prohibe `any` (MF-R2.4).
 * El diseno anticipo aqui la unica excepcion de assertion del frontend
 * (`(await response.json()) as readonly Product[]`), documentada como inevitable
 * en la frontera de red. No se implementa asi, por dos razones:
 *
 * 1. `eslint.config.mjs` fija `consistent-type-assertions` en `assertionStyle: 'never'`,
 *    de modo que el `as` no compila el lint. Silenciarlo con `@ts-` esta igual de
 *    prohibido.
 * 2. La assertion seria, ademas, una mentira verificable: afirma sobre datos que
 *    cruzaron la red y que el compilador no puede comprobar. Un backend que devuelva
 *    `{}` o `null` con `200` produciria un `Product[]` fantasma que reventaria mas
 *    tarde, dentro del store o del render, lejos de su causa.
 *
 * En su lugar el `any` se recibe en una variable declarada `unknown` —la unica
 * conversion que el compilador acepta sin assertion— y se estrecha con type guards
 * en este mismo modulo. Un cuerpo que no respeta el contrato se trata como una
 * respuesta no satisfactoria mas: `ApiClientError` con el mensaje generico. Es el
 * mismo criterio que `toProduct` aplico en el backend sobre las filas de Prisma:
 * el narrowing vive en un unico punto de entrada y hacia dentro todo esta tipado.
 */

/** Error tipado del cliente. Su `message` es apto para mostrarse tal cual (FC-R2.3). */
export class ApiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Mensaje de reserva. Cubre los tres casos en que el backend no dice nada util:
 * fallo de red, cuerpo que no es JSON y cuerpo JSON que no respeta `ApiError`.
 */
const GENERIC = 'No se pudo contactar con el servidor.';

const CATALOG_URL = '/api/products';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * `.some(...)` y no `.includes(...)`: `includes` sobre la tupla `readonly
 * ProductCategory[]` exige un argumento ya estrechado, lo que obligaria a una
 * assertion. La comparacion `===` contra el literal es legal y el predicado hace
 * el narrowing. Se compara contra el literal sin tilde, nunca contra la etiqueta
 * de `CATEGORY_LABEL`.
 */
const isProductCategory = (value: unknown): value is ProductCategory =>
  PRODUCT_CATEGORIES.some((category) => category === value);

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
 * Solo se exige lo que se consume. `messageFrom` lee `error.message` y nada mas, asi
 * que el guard pide `error.message` y nada mas: verificar tambien `code` haria que un
 * `code` desconocido descartara un mensaje perfectamente mostrable.
 */
const isApiError = (value: unknown): value is ApiError =>
  isRecord(value) &&
  isRecord(value.error) &&
  typeof value.error.message === 'string';

/**
 * Extrae el mensaje de una respuesta no satisfactoria: el del cuerpo cuando respeta
 * la forma `ApiError`, y `GENERIC` cuando no la respeta o cuando el cuerpo no es JSON
 * —un `502` de un proxy devuelve HTML, y un `204` no devuelve nada— (FC-R2.3).
 */
const messageFrom = async (response: Response): Promise<string> => {
  let body: unknown;
  try {
    // `any` -> `unknown`: la unica conversion que no necesita assertion.
    body = await response.json();
  } catch {
    return GENERIC;
  }
  return isApiError(body) ? body.error.message : GENERIC;
};

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
    throw new ApiClientError(GENERIC);
  }

  if (!response.ok) {
    throw new ApiClientError(await messageFrom(response));
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiClientError(GENERIC);
  }

  if (!isCatalog(body)) {
    throw new ApiClientError(GENERIC);
  }

  return body;
};
