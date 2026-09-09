import { CATALOG_PRODUCTS } from '@core/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchCatalog } from './catalog.api';
import { ApiClientError } from './http';

import type { ApiError } from '@core/shared';

/**
 * Suite del Cliente_Api (FC-R6.1).
 *
 * Se dobla `fetch` y nada mas. No hay servidor, ni proxy, ni MSW: el modulo bajo prueba
 * es justamente el unico que invoca `fetch`, asi que doblar la funcion global cubre toda
 * su frontera y deja el resto del codigo real, incluidos los type guards que estrechan
 * el cuerpo de la respuesta.
 *
 * El doble va tipado con `vi.fn<typeof fetch>()`: el mock respeta la firma de `fetch`, de
 * modo que un `mockResolvedValue` con algo que no es una `Response` no compila. Nada de
 * `any` ni de assertions en los dobles, igual que en produccion (MF-R2.4).
 *
 * Cada caso construye su `Response` real dentro del `mockResolvedValue`. El cuerpo de una
 * `Response` se consume una sola vez, asi que ningun caso invoca `fetchCatalog` dos veces
 * sobre la misma respuesta: por eso el rechazo se captura con `rejectionOf` en lugar de
 * repetir la llamada.
 */

/** Mensajes de usuario, fijados aqui a proposito: son contrato de UI, no detalle interno. */
const GENERIC = 'No se pudo contactar con el servidor.';

const CATALOG_URL = '/api/products';

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/**
 * Captura el `ApiClientError` de una promesa que debe rechazar, consumiendo la respuesta
 * una unica vez. Devolver el error tipado permite afirmar sobre su clase y su mensaje sin
 * volver a llamar a `fetchCatalog`, y sin `as`: el `instanceof` hace el narrowing.
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

const fetchDouble = vi.fn<typeof fetch>();
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchDouble.mockReset();
  globalThis.fetch = fetchDouble;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('fetchCatalog (FC-R2.2)', () => {
  it('devuelve los productos tipados en una respuesta 200', async () => {
    fetchDouble.mockResolvedValue(jsonResponse(CATALOG_PRODUCTS, 200));

    const catalog = await fetchCatalog();

    expect(catalog).toHaveLength(6);
    expect(catalog).toStrictEqual(CATALOG_PRODUCTS);
    // Los campos que el resto de la app consume llegan con su tipo y su valor canonico.
    expect(catalog[0]?.id).toBe('PROD-001');
    expect(catalog[0]?.priceCents).toBe(129900);
    expect(catalog[0]?.category).toBe('Tecnologia');
    expect(catalog[4]?.stock).toBe(3);
  });

  it('pide el catalogo a GET /api/products', async () => {
    fetchDouble.mockResolvedValue(jsonResponse([], 200));

    await fetchCatalog();

    expect(fetchDouble).toHaveBeenCalledTimes(1);
    expect(fetchDouble).toHaveBeenCalledWith(CATALOG_URL);
  });

  it('acepta un catalogo vacio como respuesta valida', async () => {
    fetchDouble.mockResolvedValue(jsonResponse([], 200));

    await expect(fetchCatalog()).resolves.toStrictEqual([]);
  });
});

describe('fetchCatalog: respuestas no satisfactorias (FC-R2.3)', () => {
  it('usa el mensaje del cuerpo cuando el 500 respeta la forma ApiError', async () => {
    const body: ApiError = {
      error: { code: 'INTERNAL_ERROR', message: 'No se pudo leer el catalogo.' },
    };
    fetchDouble.mockResolvedValue(jsonResponse(body, 500));

    const error = await rejectionOf(fetchCatalog());

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.name).toBe('ApiClientError');
    expect(error.message).toBe('No se pudo leer el catalogo.');
  });

  it('transporta el code y los details del cuerpo en el error tipado (FK-R1.3)', async () => {
    // La UI distingue el fallo por su `code`, nunca leyendo el texto del mensaje.
    const body: ApiError = {
      error: {
        code: 'PRODUCT_NOT_FOUND',
        message: 'No existe el producto.',
        details: { productId: 'PROD-999' },
      },
    };
    fetchDouble.mockResolvedValue(jsonResponse(body, 404));

    const error = await rejectionOf(fetchCatalog());

    expect(error.code).toBe('PRODUCT_NOT_FOUND');
    expect(error.details).toStrictEqual({ productId: 'PROD-999' });
  });

  it('deja code y details ausentes cuando el cuerpo no los trae en su forma', async () => {
    // Un `code` fuera de la union no descarta un mensaje mostrable: se omite el codigo.
    fetchDouble.mockResolvedValue(
      jsonResponse({ error: { code: 'CODIGO_INVENTADO', message: 'Fallo raro.' } }, 500),
    );

    const error = await rejectionOf(fetchCatalog());

    expect(error.message).toBe('Fallo raro.');
    expect(error.code).toBeUndefined();
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

    const error = await rejectionOf(fetchCatalog());

    expect(error.message).toBe(GENERIC);
  });

  it('cae al mensaje generico cuando el cuerpo JSON no respeta ApiError', async () => {
    fetchDouble.mockResolvedValue(jsonResponse({ mensaje: 'algo fallo' }, 500));

    const error = await rejectionOf(fetchCatalog());

    expect(error.message).toBe(GENERIC);
  });

  it('cae al mensaje generico ante un fallo de red', async () => {
    // `fetch` solo rechaza por red caida; un 500 es una promesa resuelta.
    fetchDouble.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await rejectionOf(fetchCatalog());

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.message).toBe(GENERIC);
  });
});

describe('fetchCatalog: cuerpos 200 que no son un catalogo (FC-R2.3)', () => {
  it('rechaza un 200 cuyo cuerpo no es JSON', async () => {
    fetchDouble.mockResolvedValue(
      new Response('no soy json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );

    const error = await rejectionOf(fetchCatalog());

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza un 200 cuyo cuerpo no es un arreglo', async () => {
    fetchDouble.mockResolvedValue(jsonResponse({}, 200));

    await expect(rejectionOf(fetchCatalog())).resolves.toBeInstanceOf(ApiClientError);
  });

  it('rechaza un 200 con null, que tambien es JSON valido', async () => {
    fetchDouble.mockResolvedValue(jsonResponse(null, 200));

    const error = await rejectionOf(fetchCatalog());

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza un producto al que le falta un campo del contrato', async () => {
    fetchDouble.mockResolvedValue(
      jsonResponse([{ id: 'PROD-001', name: 'Laptop Pro 14"', category: 'Tecnologia' }], 200),
    );

    const error = await rejectionOf(fetchCatalog());

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza un producto con un precio que llega como cadena', async () => {
    fetchDouble.mockResolvedValue(
      jsonResponse(
        [
          {
            id: 'PROD-002',
            name: 'Auriculares Bluetooth',
            category: 'Tecnologia',
            priceCents: '7990',
            stock: 12,
          },
        ],
        200,
      ),
    );

    const error = await rejectionOf(fetchCatalog());

    expect(error.message).toBe(GENERIC);
  });

  it('rechaza una categoria con tilde, que es la etiqueta de UI y no el literal', async () => {
    // La divergencia de tilde es el fallo silencioso que el guard tiene que atrapar:
    // 'Tecnología' es la etiqueta de CATEGORY_LABEL, nunca el valor del contrato.
    fetchDouble.mockResolvedValue(
      jsonResponse(
        [
          {
            id: 'PROD-003',
            name: 'Teclado Mecánico',
            category: 'Tecnología',
            priceCents: 4550,
            stock: 8,
          },
        ],
        200,
      ),
    );

    const error = await rejectionOf(fetchCatalog());

    expect(error.message).toBe(GENERIC);
  });
});
