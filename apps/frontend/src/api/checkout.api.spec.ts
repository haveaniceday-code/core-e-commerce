import { DISCOUNT_LABEL } from '@core/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { confirmPurchase, requestPreview } from './checkout.api';
import { ApiClientError } from './http';

import type {
  ApiError,
  CheckoutRequest,
  CheckoutTotals,
  DiscountLine,
  OrderConfirmation,
  OrderConfirmationItem,
  StockShortage,
} from '@core/shared';

/**
 * Suite del Cliente_Api de checkout (FK-R6.1).
 *
 * Misma tecnica que `catalog.api.spec.ts`: se dobla `fetch` y nada mas. El modulo bajo
 * prueba es uno de los dos unicos que invocan `fetch`, asi que doblar la funcion global
 * cubre toda su frontera y deja real el resto —incluidas las guardas de runtime que
 * estrechan `CheckoutTotals` y `OrderConfirmation`, que es justo lo que interesa medir.
 *
 * El doble va tipado con `vi.fn<typeof fetch>()`: un `mockResolvedValue` con algo que no
 * es una `Response` no compila. Cero `any` y cero assertions en los dobles, igual que en
 * produccion (MF-R2.4).
 *
 * Los cuerpos que **no** respetan el contrato entran por el parametro `unknown` de
 * `jsonResponse`, que es lo que permite escribir una respuesta malformada sin un `as`:
 * el punto de estos casos es que el guard los rechace, no fingir que son del tipo.
 *
 * ## Que se afirma y que no
 *
 * Este modulo no calcula: no hay ninguna afirmacion sobre aritmetica de descuentos. Lo
 * que se verifica es la frontera —ruta, verbo, `Content-Type`, cuerpo enviado— y que un
 * cuerpo que no respeta la forma no llegue nunca al store. El fixture de totales es el
 * canonico de `testing-standards.md` (1 x `PROD-001` + `WELCOME2026`) por realismo, no
 * porque aqui se recalcule.
 */

/** Mensaje de usuario, fijado aqui a proposito: es contrato de UI, no detalle interno. */
const GENERIC = 'No se pudo contactar con el servidor.';

const PREVIEW_URL = '/api/checkout/preview';
const CHECKOUT_URL = '/api/checkout';

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/** Lo que `checkout.api.ts` debe enviar en cada peticion. */
const EXPECTED_REQUEST_HEADERS = { 'Content-Type': 'application/json' } as const;

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/**
 * Devuelve un fixture sin una de sus claves, como `unknown`.
 *
 * Es la forma de escribir "una respuesta a la que le falta un campo del contrato" sin
 * destructurar a una variable que nadie lee y sin una assertion. Se invoca con el fixture
 * ya esparcido —`{ ...TOTALS }`— porque el spread produce un tipo de objeto anonimo, que
 * es el que el compilador acepta donde se espera un `Record<string, unknown>`.
 */
const jsonWithoutKey = (source: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));

/**
 * Captura el `ApiClientError` de una promesa que debe rechazar, consumiendo la respuesta
 * una unica vez. El cuerpo de una `Response` no se puede leer dos veces, asi que ningun
 * caso repite la llamada para volver a inspeccionar el rechazo. El `instanceof` hace el
 * narrowing y devuelve el error tipado sin `as`.
 */
const rejectionOf = async (promise: Promise<unknown>): Promise<ApiClientError> => {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ApiClientError) {
      return error;
    }
    throw error;
  }
  throw new Error('Se esperaba un ApiClientError, pero la promesa se resolvio.');
};

const REQUEST: CheckoutRequest = {
  items: [{ productId: 'PROD-001', quantity: 1 }],
  couponCode: 'WELCOME2026',
};

/** Sin cupon es la **ausencia** de la propiedad, no `undefined` (exactOptionalPropertyTypes). */
const REQUEST_WITHOUT_COUPON: CheckoutRequest = {
  items: [{ productId: 'PROD-006', quantity: 2 }],
};

/**
 * Fixture canonico: 1 x `PROD-001` con `WELCOME2026`. Cascada exacta en micro-centavos,
 * un unico redondeo final (`35495.175` -> `35495`) y reparto por mayor resto en las
 * lineas, cuyo centavo sobrante va al cupon por tener el mayor resto (`.675`).
 */
const CATEGORY_LINE: DiscountLine = {
  name: 'CATEGORY',
  label: DISCOUNT_LABEL.CATEGORY,
  applied: true,
  rateBps: 1000,
  baseAmountMicros: 129_900_000_000,
  baseAmountCents: 129_900,
  discountMicros: 12_990_000_000,
  discountCents: 12_990,
};

const VOLUME_LINE: DiscountLine = {
  name: 'VOLUME',
  label: DISCOUNT_LABEL.VOLUME,
  applied: true,
  rateBps: 500,
  baseAmountMicros: 116_910_000_000,
  baseAmountCents: 116_910,
  discountMicros: 5_845_500_000,
  discountCents: 5_845,
};

const COUPON_LINE: DiscountLine = {
  name: 'COUPON',
  label: DISCOUNT_LABEL.COUPON,
  applied: true,
  rateBps: 1500,
  baseAmountMicros: 111_064_500_000,
  baseAmountCents: 111_064,
  discountMicros: 16_659_675_000,
  discountCents: 16_660,
};

const TOTALS: CheckoutTotals = {
  originalSubtotalCents: 129_900,
  lines: [CATEGORY_LINE, VOLUME_LINE, COUPON_LINE],
  rawDiscountMicros: 35_495_175_000,
  rawDiscountCents: 35_495,
  capCents: 45_465,
  capApplied: false,
  totalSavingsCents: 35_495,
  capAdjustmentCents: 0,
  effectiveDiscountBps: 2_732,
  finalTotalCents: 94_405,
};

/** Cupon desconocido o expirado: `200` con la linea de cupon en `applied: false`. */
const UNAPPLIED_COUPON_LINE: DiscountLine = {
  name: 'COUPON',
  label: DISCOUNT_LABEL.COUPON,
  applied: false,
  rateBps: 0,
  baseAmountMicros: 111_064_500_000,
  baseAmountCents: 111_064,
  discountMicros: 0,
  discountCents: 0,
};

const CONFIRMED_ITEM: OrderConfirmationItem = {
  productId: 'PROD-001',
  name: 'Laptop Pro 14"',
  category: 'Tecnologia',
  quantity: 1,
  unitPriceCents: 129_900,
  lineTotalCents: 129_900,
};

const CONFIRMATION: OrderConfirmation = {
  orderId: 'ORD-0001',
  createdAt: '2026-01-15T10:30:00.000Z',
  couponCode: 'WELCOME2026',
  items: [CONFIRMED_ITEM],
  totals: TOTALS,
};

const SHORTAGES: readonly StockShortage[] = [
  { productId: 'PROD-005', requested: 5, available: 3 },
];

const fetchDouble = vi.fn<typeof fetch>();
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchDouble.mockReset();
  globalThis.fetch = fetchDouble;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('requestPreview: respuesta satisfactoria (FK-R1.1)', () => {
  it('devuelve el CheckoutTotals validado en un 200', async () => {
    fetchDouble.mockResolvedValue(jsonResponse(TOTALS, 200));

    const totals = await requestPreview(REQUEST);

    expect(totals).toStrictEqual(TOTALS);
    // Los enteros llegan tal cual: el cliente no recalcula ni re-redondea (FK-R2.7).
    expect(totals.totalSavingsCents).toBe(35_495);
    expect(totals.finalTotalCents).toBe(94_405);
    expect(totals.capApplied).toBe(false);
    expect(totals.lines).toHaveLength(3);
  });

  it('hace POST a /api/checkout/preview con Content-Type JSON y el cuerpo de la peticion', async () => {
    fetchDouble.mockResolvedValue(jsonResponse(TOTALS, 200));

    await requestPreview(REQUEST);

    expect(fetchDouble).toHaveBeenCalledTimes(1);
    expect(fetchDouble).toHaveBeenCalledWith(PREVIEW_URL, {
      method: 'POST',
      headers: EXPECTED_REQUEST_HEADERS,
      body: JSON.stringify(REQUEST),
    });
  });

  it('serializa la peticion sin cupon como ausencia de la propiedad', async () => {
    fetchDouble.mockResolvedValue(jsonResponse(TOTALS, 200));

    await requestPreview(REQUEST_WITHOUT_COUPON);

    expect(fetchDouble).toHaveBeenCalledWith(
      PREVIEW_URL,
      expect.objectContaining({ body: '{"items":[{"productId":"PROD-006","quantity":2}]}' }),
    );
  });

  it('acepta el 200 de un cupon desconocido o expirado como ruta satisfactoria (FK-R2.6)', async () => {
    // No es un error: el backend resuelve el codigo a "sin cupon" y la senal viaja
    // dentro del desglose, en la linea COUPON con applied: false.
    const withoutCoupon: CheckoutTotals = {
      ...TOTALS,
      lines: [CATEGORY_LINE, VOLUME_LINE, UNAPPLIED_COUPON_LINE],
      rawDiscountMicros: 18_835_500_000,
      rawDiscountCents: 18_836,
      totalSavingsCents: 18_836,
      effectiveDiscountBps: 1_450,
      finalTotalCents: 111_064,
    };
    fetchDouble.mockResolvedValue(jsonResponse(withoutCoupon, 200));

    const totals = await requestPreview({ items: REQUEST.items, couponCode: 'NO_EXISTE' });

    expect(totals.lines[2]?.applied).toBe(false);
    expect(totals.lines[2]?.discountCents).toBe(0);
  });

  it('acepta un desglose sin lineas: la longitud la fija el motor, no la red', async () => {
    const empty: CheckoutTotals = {
      originalSubtotalCents: 0,
      lines: [],
      rawDiscountMicros: 0,
      rawDiscountCents: 0,
      capCents: 0,
      capApplied: false,
      totalSavingsCents: 0,
      capAdjustmentCents: 0,
      effectiveDiscountBps: 0,
      finalTotalCents: 0,
    };
    fetchDouble.mockResolvedValue(jsonResponse(empty, 200));

    await expect(requestPreview(REQUEST)).resolves.toStrictEqual(empty);
  });
});

describe('confirmPurchase: respuesta satisfactoria (FK-R1.2)', () => {
  it('devuelve el OrderConfirmation validado en un 201', async () => {
    fetchDouble.mockResolvedValue(jsonResponse(CONFIRMATION, 201));

    const confirmation = await confirmPurchase(REQUEST);

    expect(confirmation).toStrictEqual(CONFIRMATION);
    expect(confirmation.orderId).toBe('ORD-0001');
    // `createdAt` queda como cadena ISO-8601: el contrato describe lo que cruza el cable.
    expect(confirmation.createdAt).toBe('2026-01-15T10:30:00.000Z');
    expect(confirmation.totals.finalTotalCents).toBe(94_405);
  });

  it('hace POST a /api/checkout con Content-Type JSON y el cuerpo de la peticion', async () => {
    fetchDouble.mockResolvedValue(jsonResponse(CONFIRMATION, 201));

    await confirmPurchase(REQUEST);

    expect(fetchDouble).toHaveBeenCalledTimes(1);
    expect(fetchDouble).toHaveBeenCalledWith(CHECKOUT_URL, {
      method: 'POST',
      headers: EXPECTED_REQUEST_HEADERS,
      body: JSON.stringify(REQUEST),
    });
  });

  it('acepta una confirmacion sin couponCode', async () => {
    const withoutCoupon = {
      orderId: 'ORD-0002',
      createdAt: '2026-01-15T11:00:00.000Z',
      items: CONFIRMATION.items,
      totals: TOTALS,
    };
    fetchDouble.mockResolvedValue(jsonResponse(withoutCoupon, 201));

    const confirmation = await confirmPurchase(REQUEST_WITHOUT_COUPON);

    expect(confirmation.couponCode).toBeUndefined();
    expect(confirmation.orderId).toBe('ORD-0002');
  });
});

describe('checkout: el 409 de stock llega con code y details (FK-R1.3)', () => {
  it('transporta INSUFFICIENT_STOCK y las shortages del cuerpo', async () => {
    // Asi la UI reconoce el rechazo por stock sin interpretar el texto del mensaje.
    const body: ApiError = {
      error: {
        code: 'INSUFFICIENT_STOCK',
        message: 'Alguna linea del carrito supera el stock disponible.',
        details: { shortages: SHORTAGES },
      },
    };
    fetchDouble.mockResolvedValue(jsonResponse(body, 409));

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.name).toBe('ApiClientError');
    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.message).toBe('Alguna linea del carrito supera el stock disponible.');
    expect(error.details).toStrictEqual({
      shortages: [{ productId: 'PROD-005', requested: 5, available: 3 }],
    });
  });

  it('transporta el otro 409, el de la guarda del decremento, con sus propios details', async () => {
    // Mismo code, details distintos: son situaciones distintas y el usuario reacciona
    // distinto ante cada una.
    const body: ApiError = {
      error: {
        code: 'INSUFFICIENT_STOCK',
        message: 'El stock cambio mientras se confirmaba la compra.',
        details: { contendedProductIds: ['PROD-005'] },
      },
    };
    fetchDouble.mockResolvedValue(jsonResponse(body, 409));

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.details).toStrictEqual({ contendedProductIds: ['PROD-005'] });
  });

  it('transporta el code del 400 de carrito invalido', async () => {
    const body: ApiError = {
      error: { code: 'INVALID_CART', message: 'El carrito no tiene lineas.' },
    };
    fetchDouble.mockResolvedValue(jsonResponse(body, 400));

    const error = await rejectionOf(requestPreview({ items: [] }));

    expect(error.code).toBe('INVALID_CART');
    expect(error.message).toBe('El carrito no tiene lineas.');
    expect(error.details).toBeUndefined();
  });
});

describe('checkout: cuerpos de error que no respetan la forma (FK-R1.3)', () => {
  it('cae al mensaje generico cuando el cuerpo del error no envuelve un objeto error', async () => {
    fetchDouble.mockResolvedValue(jsonResponse({ mensaje: 'algo fallo' }, 500));

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.message).toBe(GENERIC);
    expect(error.code).toBeUndefined();
    expect(error.details).toBeUndefined();
  });

  it('cae al mensaje generico cuando message no es una cadena, conservando code y details', async () => {
    // Solo se exige lo que se consume: un `message` numerico no descarta un `code`
    // perfectamente utilizable, y la UI ya tiene un texto de reserva que mostrar.
    fetchDouble.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'INSUFFICIENT_STOCK',
            message: 409,
            details: { shortages: SHORTAGES },
          },
        },
        409,
      ),
    );

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.details).toStrictEqual({
      shortages: [{ productId: 'PROD-005', requested: 5, available: 3 }],
    });
  });

  it('omite un code fuera de la union ErrorCode y conserva el mensaje mostrable', async () => {
    fetchDouble.mockResolvedValue(
      jsonResponse({ error: { code: 'CODIGO_INVENTADO', message: 'Fallo raro.' } }, 500),
    );

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.message).toBe('Fallo raro.');
    expect(error.code).toBeUndefined();
  });

  it('omite unos details que no son un objeto', async () => {
    fetchDouble.mockResolvedValue(
      jsonResponse(
        { error: { code: 'INVALID_CART', message: 'Carrito invalido.', details: 'PROD-001' } },
        400,
      ),
    );

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.code).toBe('INVALID_CART');
    expect(error.details).toBeUndefined();
  });

  it('cae al mensaje generico cuando el cuerpo del error no es JSON', async () => {
    // Un 502 de un proxy devuelve HTML: `response.json()` rechaza.
    fetchDouble.mockResolvedValue(
      new Response('<html><body>Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
    expect(error.code).toBeUndefined();
  });

  it('cae al mensaje generico ante un fallo de red en preview', async () => {
    // `fetch` solo rechaza por red caida; un 409 es una promesa resuelta.
    fetchDouble.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.message).toBe(GENERIC);
  });

  it('cae al mensaje generico ante un fallo de red en checkout', async () => {
    fetchDouble.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
  });
});

describe('requestPreview: cuerpos 200 que no son un CheckoutTotals (FK-R1.1)', () => {
  it('rechaza un 200 cuyo cuerpo no es JSON', async () => {
    fetchDouble.mockResolvedValue(
      new Response('no soy json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza un 200 con null, que tambien es JSON valido', async () => {
    fetchDouble.mockResolvedValue(jsonResponse(null, 200));

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza un 200 cuyo cuerpo es un arreglo en lugar de un objeto', async () => {
    fetchDouble.mockResolvedValue(jsonResponse([TOTALS], 200));

    await expect(rejectionOf(requestPreview(REQUEST))).resolves.toBeInstanceOf(ApiClientError);
  });

  it('rechaza unos totales sin capApplied: el frontend no puede re-derivar la alerta', async () => {
    // Aceptarlo dejaria `capApplied` en undefined y la Alerta_Tope no apareceria nunca,
    // en silencio y lejos de su causa (FK-R4.4).
    fetchDouble.mockResolvedValue(jsonResponse(jsonWithoutKey({ ...TOTALS }, 'capApplied'), 200));

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza unos totales cuyo lines no es un arreglo', async () => {
    fetchDouble.mockResolvedValue(jsonResponse({ ...TOTALS, lines: 'tres' }, 200));

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza un monto que llega como cadena', async () => {
    fetchDouble.mockResolvedValue(
      jsonResponse({ ...TOTALS, totalSavingsCents: '35495' }, 200),
    );

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza una linea con un name fuera de la union DiscountName', async () => {
    fetchDouble.mockResolvedValue(
      jsonResponse({ ...TOTALS, lines: [{ ...CATEGORY_LINE, name: 'ENVIO' }] }, 200),
    );

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza una linea sin sus campos Micros, que son parte del contrato auditable', async () => {
    // Los micros se exigen aunque la UI no los pinte: sin ellos la respuesta no es un
    // DiscountLine, y el hueco apareceria en quien si los lea en lugar de en su frontera.
    const lineWithoutMicros = jsonWithoutKey({ ...CATEGORY_LINE }, 'discountMicros');
    fetchDouble.mockResolvedValue(jsonResponse({ ...TOTALS, lines: [lineWithoutMicros] }, 200));

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza una linea cuyo applied no es booleano', async () => {
    fetchDouble.mockResolvedValue(
      jsonResponse({ ...TOTALS, lines: [{ ...VOLUME_LINE, applied: 'si' }] }, 200),
    );

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza una linea sin label, porque la UI no compone el texto', async () => {
    const lineWithoutLabel = jsonWithoutKey({ ...COUPON_LINE }, 'label');
    fetchDouble.mockResolvedValue(jsonResponse({ ...TOTALS, lines: [lineWithoutLabel] }, 200));

    const error = await rejectionOf(requestPreview(REQUEST));

    expect(error.message).toBe(GENERIC);
  });
});

describe('confirmPurchase: cuerpos 201 que no son un OrderConfirmation (FK-R1.2)', () => {
  it('rechaza un 201 cuyo cuerpo no es JSON', async () => {
    fetchDouble.mockResolvedValue(
      new Response('', { status: 201, headers: { 'content-type': 'text/plain' } }),
    );

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza una confirmacion sin orderId', async () => {
    fetchDouble.mockResolvedValue(
      jsonResponse(jsonWithoutKey({ ...CONFIRMATION }, 'orderId'), 201),
    );

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza un createdAt que no es cadena', async () => {
    fetchDouble.mockResolvedValue(jsonResponse({ ...CONFIRMATION, createdAt: 1_768_473_000 }, 201));

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza un couponCode que llega como null, el valor de la columna de Prisma', async () => {
    // El contrato describe lo que queda tras JSON.stringify: ausente o cadena, nunca
    // el null de la columna. Traducirlo es responsabilidad del mapeo del backend.
    fetchDouble.mockResolvedValue(jsonResponse({ ...CONFIRMATION, couponCode: null }, 201));

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza una confirmacion cuyo items no es un arreglo', async () => {
    fetchDouble.mockResolvedValue(jsonResponse({ ...CONFIRMATION, items: {} }, 201));

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza una linea con la categoria con tilde, que es la etiqueta de UI', async () => {
    // 'Tecnología' es CATEGORY_LABEL.Tecnologia, nunca el literal del contrato: la
    // divergencia de tilde es el fallo silencioso que el guard existe para atrapar.
    fetchDouble.mockResolvedValue(
      jsonResponse(
        {
          ...CONFIRMATION,
          items: [{ ...CONFIRMED_ITEM, category: 'Tecnología' }],
        },
        201,
      ),
    );

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza una linea sin unitPriceCents, el monto efectivamente cobrado', async () => {
    fetchDouble.mockResolvedValue(
      jsonResponse(
        {
          ...CONFIRMATION,
          items: [
            {
              productId: 'PROD-001',
              name: 'Laptop Pro 14"',
              category: 'Tecnologia',
              quantity: 1,
              lineTotalCents: 129_900,
            },
          ],
        },
        201,
      ),
    );

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza una confirmacion cuyo totals no respeta CheckoutTotals', async () => {
    fetchDouble.mockResolvedValue(
      jsonResponse({ ...CONFIRMATION, totals: { originalSubtotalCents: 129_900 } }, 201),
    );

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza una confirmacion sin totals: el desglose no es opcional', async () => {
    fetchDouble.mockResolvedValue(jsonResponse(jsonWithoutKey({ ...CONFIRMATION }, 'totals'), 201));

    const error = await rejectionOf(confirmPurchase(REQUEST));

    expect(error.message).toBe(GENERIC);
  });
});
