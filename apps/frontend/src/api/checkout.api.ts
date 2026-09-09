import { DISCOUNT_NAMES } from '@core/shared';

import {
  ApiClientError,
  GENERIC_ERROR_MESSAGE,
  apiErrorFrom,
  isProductCategory,
  isRecord,
  readJsonBody,
} from './http';

import type {
  CheckoutRequest,
  CheckoutTotals,
  DiscountLine,
  DiscountName,
  OrderConfirmation,
  OrderConfirmationItem,
} from '@core/shared';

/**
 * Cliente de la API de checkout (FK-R1.1, FK-R1.2).
 *
 * Dos operaciones y ninguna decision: `requestPreview` pide el desglose y
 * `confirmPurchase` confirma la compra. El modulo no calcula descuentos, no redondea y no
 * deriva totales; devuelve los enteros que el backend ya calculo. La aritmetica de dinero
 * vive en `packages/shared` y la ejecuta el backend, que es la unica fuente de verdad del
 * calculo.
 *
 * El error tipado y las guardas comunes vienen de `http.ts` (FK-R1.4). Aqui quedan las
 * guardas propias de estos dos contratos —`CheckoutTotals`, `DiscountLine`,
 * `OrderConfirmation` y `OrderConfirmationItem`— y las dos rutas.
 *
 * ## Cero assertions en la frontera
 *
 * El cuerpo entra como `unknown` y se estrecha con predicados. `(await response.json()) as
 * CheckoutTotals` seria una mentira verificable: un backend que devolviera `{}` con `200`
 * produciria un objeto fantasma cuyo `totals.lines` explotaria al renderizar, lejos de su
 * causa. Un cuerpo que no respeta el contrato se trata como una respuesta no satisfactoria
 * mas y sale por `ApiClientError`.
 *
 * ## Un cupon invalido no llega por aqui
 *
 * Un codigo desconocido o expirado **no es un error**: el backend lo resuelve a "sin
 * cupon" y responde `200` con la linea `COUPON` en `applied: false`. Por eso no hay rama
 * para el: es la ruta satisfactoria, y la senal viaja dentro del desglose.
 */

const PREVIEW_URL = '/api/checkout/preview';
const CHECKOUT_URL = '/api/checkout';

const JSON_REQUEST_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * `.some(...)` y no `.includes(...)`: `includes` sobre la tupla `readonly DiscountName[]`
 * exige un argumento ya estrechado, lo que obligaria a una assertion. La comparacion
 * `===` contra el literal es legal y el predicado hace el narrowing.
 */
const isDiscountName = (value: unknown): value is DiscountName =>
  DISCOUNT_NAMES.some((name) => name === value);

/**
 * Valida la forma estructural de `DiscountLine`, incluidos los campos `*Micros`.
 *
 * Los micros se exigen aunque la UI no los pinte: son parte del contrato y lo que hace
 * auditable el desglose. Aceptar una linea sin ellos dejaria entrar una respuesta que no
 * es un `DiscountLine`, y el hueco apareceria en quien si los lea —los tests— en lugar de
 * aqui, que es su frontera.
 *
 * No se validan rangos (`rateBps` entre 0 y 10000, montos no negativos): eso lo garantiza
 * el motor, que es quien los produce. Aqui se comprueba solo lo que el tipo promete.
 */
const isDiscountLine = (value: unknown): value is DiscountLine =>
  isRecord(value) &&
  isDiscountName(value.name) &&
  typeof value.label === 'string' &&
  typeof value.applied === 'boolean' &&
  typeof value.rateBps === 'number' &&
  typeof value.baseAmountMicros === 'number' &&
  typeof value.baseAmountCents === 'number' &&
  typeof value.discountMicros === 'number' &&
  typeof value.discountCents === 'number';

/**
 * Valida `CheckoutTotals`. Comprueba que `lines` sea un arreglo de `DiscountLine`, pero no
 * que tenga exactamente tres: la longitud la fija el motor segun las estrategias que
 * recibe, y el `DiscountBreakdown` recorre lo que llega. Exigir `length === 3` aqui
 * convertiria una decision del motor en un fallo de red.
 */
const isCheckoutTotals = (value: unknown): value is CheckoutTotals =>
  isRecord(value) &&
  typeof value.originalSubtotalCents === 'number' &&
  Array.isArray(value.lines) &&
  value.lines.every((line: unknown) => isDiscountLine(line)) &&
  typeof value.rawDiscountMicros === 'number' &&
  typeof value.rawDiscountCents === 'number' &&
  typeof value.capCents === 'number' &&
  typeof value.capApplied === 'boolean' &&
  typeof value.totalSavingsCents === 'number' &&
  typeof value.effectiveDiscountBps === 'number' &&
  typeof value.finalTotalCents === 'number';

const isOrderConfirmationItem = (value: unknown): value is OrderConfirmationItem =>
  isRecord(value) &&
  typeof value.productId === 'string' &&
  typeof value.name === 'string' &&
  isProductCategory(value.category) &&
  typeof value.quantity === 'number' &&
  typeof value.unitPriceCents === 'number' &&
  typeof value.lineTotalCents === 'number';

/**
 * Valida `OrderConfirmation`, con `totals` embebido y validado por su propia guarda.
 *
 * `couponCode` es opcional **ausente** bajo `exactOptionalPropertyTypes`: se acepta que no
 * este, y si esta tiene que ser una cadena. Un cuerpo JSON nunca trae la propiedad con
 * valor `undefined`, asi que la comprobacion cubre los dos casos reales —presente con
 * codigo, o ausente porque la compra fue sin cupon— sin abrir un tercero.
 *
 * `createdAt` se valida como cadena y no se convierte a `Date`: el contrato describe lo
 * que cruza el cable, y la conversion es asunto de quien formatee la fecha.
 */
const isOrderConfirmation = (value: unknown): value is OrderConfirmation =>
  isRecord(value) &&
  typeof value.orderId === 'string' &&
  typeof value.createdAt === 'string' &&
  (value.couponCode === undefined || typeof value.couponCode === 'string') &&
  Array.isArray(value.items) &&
  value.items.every((item: unknown) => isOrderConfirmationItem(item)) &&
  isCheckoutTotals(value.totals);

/**
 * `POST` con cuerpo JSON y respuesta estrechada por la guarda de su contrato.
 *
 * Las dos operaciones difieren en la ruta y en el tipo que devuelven, no en el
 * procedimiento: mismo verbo, mismo `Content-Type`, mismo tratamiento de un estado no
 * `ok`, mismo rechazo de un cuerpo que no respeta la forma. El parametro `isExpected` es
 * un type predicate, de modo que `T` se infiere del guard y el `return body` compila sin
 * assertion.
 *
 * @throws {ApiClientError} red caida, estado no `ok`, o cuerpo que no respeta el contrato.
 */
const postJson = async <T>(
  url: string,
  request: CheckoutRequest,
  isExpected: (value: unknown) => value is T,
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: JSON_REQUEST_HEADERS,
      body: JSON.stringify(request),
    });
  } catch {
    // `fetch` solo rechaza por fallo de red; un `409` es una promesa resuelta.
    throw new ApiClientError(GENERIC_ERROR_MESSAGE);
  }

  if (!response.ok) {
    // Trae `code` y `details` cuando el cuerpo respeta `ApiError`: es como la UI
    // reconoce el `409` de stock sin leer el texto del mensaje (FK-R1.3).
    throw await apiErrorFrom(response);
  }

  const body = await readJsonBody(response);

  if (!isExpected(body)) {
    throw new ApiClientError(GENERIC_ERROR_MESSAGE);
  }

  return body;
};

/**
 * Pide el desglose a `POST /api/checkout/preview` (FK-R1.1).
 *
 * No tiene efectos secundarios en el servidor: no valida stock, no persiste y no
 * decrementa. Existe para que el frontend muestre el desglose en vivo sin dejar de ser el
 * backend la unica fuente de verdad del calculo.
 *
 * @throws {ApiClientError} red caida, estado no `ok`, o cuerpo que no es `CheckoutTotals`.
 */
export const requestPreview = (request: CheckoutRequest): Promise<CheckoutTotals> =>
  postJson(PREVIEW_URL, request, isCheckoutTotals);

/**
 * Confirma la compra contra `POST /api/checkout` (FK-R1.2).
 *
 * El backend valida stock, recalcula con el mismo motor que `preview`, decrementa y
 * persiste. La peticion lleva solo lineas y cupon: `CheckoutRequest` no tiene donde poner
 * un monto, y esa ausencia es lo que hace estructuralmente imposible que el cliente
 * influya en el total (FK-R5.6).
 *
 * @throws {ApiClientError} red caida, estado no `ok` —incluido el `409` de stock, que llega
 * con `code` y `details`—, o cuerpo que no es `OrderConfirmation`.
 */
export const confirmPurchase = (request: CheckoutRequest): Promise<OrderConfirmation> =>
  postJson(CHECKOUT_URL, request, isOrderConfirmation);
