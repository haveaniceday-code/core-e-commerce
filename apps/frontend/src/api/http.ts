import { ERROR_CODES, PRODUCT_CATEGORIES } from '@core/shared';

import type { ErrorCode, ProductCategory } from '@core/shared';

/**
 * Piezas comunes del Cliente_Api: el error tipado y las guardas que estrechan una
 * respuesta HTTP (FK-R1.4).
 *
 * Vivian en `catalog.api.ts` cuando el catalogo era su unico consumidor. Ahora
 * `checkout.api.ts` necesita exactamente las mismas, asi que se declaran una sola vez
 * aqui. No es una capa nueva: es el mismo codigo en el sitio donde ambos lo ven, y la
 * alternativa —copiarlas— dejaria dos definiciones de `ApiClientError` que un
 * `instanceof` no reconoceria como la misma clase.
 *
 * Este modulo no invoca `fetch`: lo hacen `catalog.api.ts` y `checkout.api.ts`, que
 * siguen siendo los unicos puntos de la app que conocen rutas y verbos (FC-R2.1).
 *
 * ## La frontera de red y la assertion que no se escribe
 *
 * `Response.json()` devuelve `Promise<any>`, y el proyecto prohibe `any` (MF-R2.4).
 * El `any` se recibe en una variable declarada `unknown` —la unica conversion que el
 * compilador acepta sin assertion— y se estrecha con type guards. Un cuerpo que no
 * respeta el contrato se trata como una respuesta no satisfactoria mas. Escribir
 * `(await response.json()) as CheckoutTotals` seria una mentira verificable: afirma
 * sobre datos que cruzaron la red, y un backend que devuelva `{}` con `200` produciria
 * un objeto fantasma que reventaria mas tarde, lejos de su causa.
 */

/**
 * Error tipado del cliente. Su `message` es apto para mostrarse tal cual (FC-R2.3).
 *
 * `code` y `details` son la ampliacion de esta entrega (FK-R1.3): con ellos la UI
 * distingue el `409` de stock de cualquier otro fallo **sin interpretar el texto del
 * mensaje**, que es justamente lo que un codigo de error existe para evitar. Ambos son
 * opcionales porque un fallo de red o un cuerpo que no respeta `ApiError` no traen
 * ninguno de los dos, y fingirlos con un valor por defecto —`INTERNAL_ERROR`, por
 * ejemplo— haria indistinguible "el backend dijo esto" de "no dijo nada".
 *
 * `details` viaja como `Record<string, unknown>`: quien lo lea esta obligado a
 * estrechar antes de usarlo. Es el mismo contrato que `ApiError.error.details`.
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code?: ErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Mensaje de reserva. Cubre los tres casos en que el backend no dice nada util:
 * fallo de red, cuerpo que no es JSON y cuerpo JSON que no respeta `ApiError`.
 */
export const GENERIC_ERROR_MESSAGE = 'No se pudo contactar con el servidor.';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * `.some(...)` y no `.includes(...)`: `includes` sobre la tupla `readonly ErrorCode[]`
 * exige un argumento ya estrechado, lo que obligaria a una assertion. La comparacion
 * `===` contra el literal es legal y el predicado hace el narrowing.
 */
export const isErrorCode = (value: unknown): value is ErrorCode =>
  ERROR_CODES.some((code) => code === value);

/**
 * Misma tecnica que `isErrorCode`, y esta aqui por la misma razon que `ApiClientError`:
 * la categoria llega tanto en `Product` como en `OrderConfirmationItem`, asi que tiene
 * dos consumidores y se declara una sola vez (FK-R1.4).
 *
 * Se compara contra el literal **sin tilde**. `'Tecnología'` es la etiqueta de
 * `CATEGORY_LABEL` y nunca un valor del contrato: aceptarla seria el fallo silencioso
 * que este guard existe para atrapar.
 */
export const isProductCategory = (value: unknown): value is ProductCategory =>
  PRODUCT_CATEGORIES.some((category) => category === value);

/**
 * Devuelve el objeto `error` del cuerpo cuando existe, sin afirmar nada sobre sus
 * campos.
 *
 * Deliberadamente no es un predicado `value is ApiError`. Un guard asi prometeria
 * `code: ErrorCode` habiendo comprobado unicamente `message`, y ahora que el `code` se
 * lee de verdad esa promesa produciria codigos inventados. Cada campo se verifica en
 * `apiErrorFrom` con su propia guarda, y el que no pase se omite.
 */
const errorPayloadOf = (body: unknown): Record<string, unknown> | null =>
  isRecord(body) && isRecord(body.error) ? body.error : null;

/**
 * Construye el `ApiClientError` de una respuesta no satisfactoria.
 *
 * El mensaje sale del cuerpo cuando respeta la forma `ApiError`, y es `GENERIC` cuando
 * no la respeta o cuando el cuerpo no es JSON —un `502` de un proxy devuelve HTML, y un
 * `204` no devuelve nada— (FC-R2.3). Solo se exige lo que se consume: un `code`
 * desconocido no descarta un mensaje perfectamente mostrable, simplemente deja `code`
 * ausente.
 */
export const apiErrorFrom = async (response: Response): Promise<ApiClientError> => {
  let body: unknown;
  try {
    // `any` -> `unknown`: la unica conversion que no necesita assertion.
    body = await response.json();
  } catch {
    return new ApiClientError(GENERIC_ERROR_MESSAGE);
  }

  const payload = errorPayloadOf(body);
  if (payload === null) {
    return new ApiClientError(GENERIC_ERROR_MESSAGE);
  }

  const message = typeof payload.message === 'string' ? payload.message : GENERIC_ERROR_MESSAGE;
  const code = isErrorCode(payload.code) ? payload.code : undefined;
  const details = isRecord(payload.details) ? payload.details : undefined;

  return new ApiClientError(message, code, details);
};

/**
 * Lee el cuerpo de una respuesta satisfactoria como `unknown`, para que quien llama lo
 * estreche con la guarda de su propio contrato.
 *
 * @throws {ApiClientError} el cuerpo no es JSON.
 */
export const readJsonBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new ApiClientError(GENERIC_ERROR_MESSAGE);
  }
};
