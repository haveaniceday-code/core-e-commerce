import { CATALOG_PRODUCTS } from '@core/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError, fetchCatalog } from '../api/catalog.api';

import { selectCartLines, selectSubtotalCents, useCartStore } from './cart.store';

import type { Product } from '@core/shared';

/**
 * Suite del Store_Carrito y del Selector_Subtotal (FC-R6.2, FC-R6.3, FC-R6.4).
 *
 * **Sin renderizar React.** Se opera sobre `useCartStore.getState()` y
 * `useCartStore.setState()` directamente, que es exactamente lo que FC-R3.1 compra al
 * declarar el store fuera de los componentes: la logica del carrito se verifica sin
 * `render`, sin `act` y sin jsdom de por medio.
 *
 * El doble es del **Cliente_Api**, no de `fetch`: `catalog.api.spec.ts` ya cubre la
 * frontera de red con `fetch` doblado, y repetirla aqui probaria dos veces lo mismo.
 * Lo que este archivo necesita verificar de `loadCatalog` son sus tres salidas —exito,
 * `ApiClientError` traducido a estado, y el fallo inesperado— y el ultimo **no es
 * alcanzable** doblando `fetch`, porque `fetchCatalog` solo lanza `ApiClientError`.
 *
 * El mock es parcial y conserva la clase real `ApiClientError`: el `instanceof` del store
 * compara contra la misma clase que este spec lanza. Un mock total del modulo daria dos
 * clases distintas con el mismo nombre y el `instanceof` fallaria en silencio,
 * confundiendo la rama del mensaje traducido con la del mensaje inesperado.
 *
 * `vi.fn<typeof ...>` y `vi.mocked` mantienen el doble tipado: cero `any` y cero
 * assertions, igual que en produccion (MF-R2.4).
 */
vi.mock('../api/catalog.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/catalog.api')>();
  return { ...actual, fetchCatalog: vi.fn<typeof actual.fetchCatalog>() };
});

const fetchCatalogDouble = vi.mocked(fetchCatalog);

/**
 * Estado inicial capturado al cargar el modulo, antes de que ningun `beforeEach` lo
 * reemplace. Es la unica forma honesta de afirmar sobre el estado inicial de FC-R3.1:
 * leerlo despues de haberlo fijado seria una tautologia.
 */
const INITIAL_STATE = useCartStore.getState();

/** Precios del catalogo canonico. Cada monto esperado se deriva a mano de esta tabla. */
const LAPTOP = 'PROD-001'; //     129900
const AURICULARES = 'PROD-002'; //  7990
const TECLADO = 'PROD-003'; //      4550
const LAMPARA = 'PROD-004'; //      3200
const SABANAS = 'PROD-005'; //      5900, stock 3
const CAMISETA = 'PROD-006'; //     1990

const resetStore = (catalog: readonly Product[] = CATALOG_PRODUCTS): void => {
  useCartStore.setState({ catalog, items: {}, status: 'idle', errorMessage: null });
};

const items = (): Readonly<Record<string, number>> => useCartStore.getState().items;

const subtotal = (): number => selectSubtotalCents(useCartStore.getState());

const lines = (): readonly { product: Product; quantity: number }[] =>
  selectCartLines(useCartStore.getState());

/** Fija cantidades sin pasar por `add`, para que el caso bajo prueba sea uno solo. */
const givenItems = (given: Readonly<Record<string, number>>): void => {
  useCartStore.setState({ items: given });
};

const addTimes = (productId: string, times: number): void => {
  for (let i = 0; i < times; i += 1) {
    useCartStore.getState().add(productId);
  }
};

beforeEach(() => {
  fetchCatalogDouble.mockReset();
  resetStore();
});

describe('estado inicial (FC-R3.1)', () => {
  it('arranca con catalogo vacio, carrito vacio y sin error', () => {
    expect(INITIAL_STATE.catalog).toStrictEqual([]);
    expect(INITIAL_STATE.items).toStrictEqual({});
    expect(INITIAL_STATE.status).toBe('idle');
    expect(INITIAL_STATE.errorMessage).toBeNull();
  });

  it('con carrito vacio el subtotal es 0 y no hay lineas (FC-R4.3)', () => {
    expect(lines()).toStrictEqual([]);
    expect(subtotal()).toBe(0);
  });
});

describe('add (FC-R3.3)', () => {
  it('crea la linea con cantidad 1 cuando el producto esta ausente', () => {
    useCartStore.getState().add(LAMPARA);

    expect(items()).toStrictEqual({ [LAMPARA]: 1 });
    expect(subtotal()).toBe(3200);
  });

  it('incrementa en 1 cuando el producto ya esta en el carrito', () => {
    givenItems({ [TECLADO]: 2 });

    useCartStore.getState().add(TECLADO);

    expect(items()).toStrictEqual({ [TECLADO]: 3 });
    // 4550 x 3 = 13650
    expect(subtotal()).toBe(13650);
  });

  it('no toca las demas lineas al agregar una nueva', () => {
    givenItems({ [AURICULARES]: 1 });

    useCartStore.getState().add(CAMISETA);

    expect(items()).toStrictEqual({ [AURICULARES]: 1, [CAMISETA]: 1 });
  });
});

describe('decrement (FC-R3.4)', () => {
  it('baja de 2 a 1 conservando la linea', () => {
    givenItems({ [LAPTOP]: 2 });

    useCartStore.getState().decrement(LAPTOP);

    expect(items()).toStrictEqual({ [LAPTOP]: 1 });
    expect(subtotal()).toBe(129900);
  });

  it('elimina la linea al llegar a 0, en lugar de dejarla en cero (I1)', () => {
    givenItems({ [LAPTOP]: 1 });

    useCartStore.getState().decrement(LAPTOP);

    // Ni `{ 'PROD-001': 0 }` ni una clave con `undefined`: la linea desaparece.
    expect(items()).toStrictEqual({});
    expect(Object.keys(items())).toStrictEqual([]);
    expect(lines()).toStrictEqual([]);
    expect(subtotal()).toBe(0);
  });

  it('no hace nada cuando el producto esta ausente del carrito', () => {
    givenItems({ [CAMISETA]: 2 });
    const before = items();

    useCartStore.getState().decrement(LAPTOP);

    expect(items()).toStrictEqual(before);
    expect(subtotal()).toBe(3980);
  });

  it('no hace nada sobre un carrito vacio', () => {
    useCartStore.getState().decrement(LAPTOP);

    expect(items()).toStrictEqual({});
  });

  it('deja intactas las demas lineas al eliminar una', () => {
    givenItems({ [LAPTOP]: 1, [CAMISETA]: 3 });

    useCartStore.getState().decrement(LAPTOP);

    expect(items()).toStrictEqual({ [CAMISETA]: 3 });
    // 1990 x 3 = 5970
    expect(subtotal()).toBe(5970);
  });
});

describe('remove (FC-R3.5)', () => {
  it('elimina entera una linea con cantidad 3', () => {
    givenItems({ [TECLADO]: 3 });

    useCartStore.getState().remove(TECLADO);

    expect(items()).toStrictEqual({});
    expect(subtotal()).toBe(0);
  });

  it('elimina solo la linea indicada', () => {
    givenItems({ [TECLADO]: 3, [LAMPARA]: 2 });

    useCartStore.getState().remove(TECLADO);

    expect(items()).toStrictEqual({ [LAMPARA]: 2 });
    // 3200 x 2 = 6400
    expect(subtotal()).toBe(6400);
  });

  it('no hace nada cuando el producto no esta en el carrito', () => {
    givenItems({ [LAMPARA]: 1 });

    useCartStore.getState().remove(SABANAS);

    expect(items()).toStrictEqual({ [LAMPARA]: 1 });
  });
});

describe('selectCartLines (FC-R3.2)', () => {
  it('resuelve nombre, categoria y precio contra el catalogo, no contra la linea', () => {
    givenItems({ [LAPTOP]: 2 });

    const [line] = lines();

    expect(line?.quantity).toBe(2);
    expect(line?.product.name).toBe('Laptop Pro 14"');
    expect(line?.product.priceCents).toBe(129900);
    // Literal sin tilde: la tilde vive solo en CATEGORY_LABEL.
    expect(line?.product.category).toBe('Tecnologia');
  });

  it('descarta identificadores que el catalogo no conoce', () => {
    givenItems({ [LAMPARA]: 1, 'PROD-999': 4 });

    expect(lines()).toHaveLength(1);
    expect(lines()[0]?.product.id).toBe(LAMPARA);
    // El id fantasma no aporta al subtotal ni rompe el recorrido.
    expect(subtotal()).toBe(3200);
  });

  it('sin catalogo cargado no hay lineas aunque haya items', () => {
    resetStore([]);
    givenItems({ [LAPTOP]: 1 });

    expect(lines()).toStrictEqual([]);
    expect(subtotal()).toBe(0);
  });

  it('conserva el orden en que se fueron agregando los productos', () => {
    useCartStore.getState().add(CAMISETA);
    useCartStore.getState().add(LAPTOP);
    useCartStore.getState().add(LAMPARA);

    expect(lines().map((line) => line.product.id)).toStrictEqual([CAMISETA, LAPTOP, LAMPARA]);
  });
});

describe('selectSubtotalCents (FC-R4.1, FC-R4.2, FC-R4.3)', () => {
  it('carrito vacio devuelve 0 sin lanzar excepcion', () => {
    expect(subtotal()).toBe(0);
  });

  it('una sola linea con cantidad 1', () => {
    givenItems({ [AURICULARES]: 1 });

    expect(subtotal()).toBe(7990);
  });

  it('una sola linea con cantidad mayor a 1', () => {
    givenItems({ [AURICULARES]: 4 });

    // 7990 x 4 = 31960
    expect(subtotal()).toBe(31960);
  });

  it('varias lineas con cantidad 1', () => {
    givenItems({ [AURICULARES]: 1, [CAMISETA]: 1 });

    // 7990 + 1990 = 9980
    expect(subtotal()).toBe(9980);
  });

  it('varias lineas con cantidades distintas', () => {
    givenItems({ [LAPTOP]: 2, [CAMISETA]: 5, [LAMPARA]: 3 });

    // 129900x2 + 1990x5 + 3200x3 = 259800 + 9950 + 9600 = 279350
    expect(subtotal()).toBe(279350);
  });

  it('devuelve un entero exacto: producto de enteros, sin redondeo ni float', () => {
    givenItems({ [TECLADO]: 7, [SABANAS]: 2 });

    const value = subtotal();

    // 4550x7 + 5900x2 = 31850 + 11800 = 43650
    expect(value).toBe(43650);
    expect(Number.isInteger(value)).toBe(true);
  });

  it('se deriva en cada lectura y refleja el cambio de inmediato (FC-R4.2)', () => {
    givenItems({ [LAMPARA]: 1 });
    expect(subtotal()).toBe(3200);

    useCartStore.getState().add(LAMPARA);
    expect(subtotal()).toBe(6400);

    useCartStore.getState().remove(LAMPARA);
    expect(subtotal()).toBe(0);
  });
});

describe('superar el stock disponible (FC-R3.6, FC-R6.4, I5)', () => {
  it('agregar PROD-005 seis veces con stock 3 da cantidad 6 y subtotal 35400', () => {
    // El carrito no limita por stock a proposito (D1): el rechazo es del backend, y un
    // tope aqui haria imposible demostrar el 409 en vivo.
    expect(() => {
      addTimes(SABANAS, 6);
    }).not.toThrow();

    expect(items()).toStrictEqual({ [SABANAS]: 6 });
    expect(lines()[0]?.product.stock).toBe(3);
    // 5900 x 6 = 35400
    expect(subtotal()).toBe(35400);
  });

  it('no marca error ni cambia el status al superar el stock', () => {
    addTimes(SABANAS, 6);

    expect(useCartStore.getState().status).toBe('idle');
    expect(useCartStore.getState().errorMessage).toBeNull();
  });
});

describe('loadCatalog', () => {
  it('deja el catalogo y status ready en el camino feliz', async () => {
    resetStore([]);
    fetchCatalogDouble.mockResolvedValue(CATALOG_PRODUCTS);

    await useCartStore.getState().loadCatalog();

    expect(fetchCatalogDouble).toHaveBeenCalledTimes(1);
    expect(useCartStore.getState().catalog).toStrictEqual(CATALOG_PRODUCTS);
    expect(useCartStore.getState().status).toBe('ready');
    expect(useCartStore.getState().errorMessage).toBeNull();
  });

  it('marca status loading mientras la peticion esta en vuelo', async () => {
    fetchCatalogDouble.mockResolvedValue(CATALOG_PRODUCTS);

    const pending = useCartStore.getState().loadCatalog();
    expect(useCartStore.getState().status).toBe('loading');

    await pending;
    expect(useCartStore.getState().status).toBe('ready');
  });

  it('traduce el ApiClientError a status error con su mensaje (FC-R5.6)', async () => {
    fetchCatalogDouble.mockRejectedValue(new ApiClientError('No se pudo leer el catalogo.'));

    await useCartStore.getState().loadCatalog();

    expect(useCartStore.getState().status).toBe('error');
    expect(useCartStore.getState().errorMessage).toBe('No se pudo leer el catalogo.');
  });

  it('conserva el catalogo previo cuando una recarga falla', async () => {
    fetchCatalogDouble.mockRejectedValue(new ApiClientError('Se cayo la red.'));

    await useCartStore.getState().loadCatalog();

    // Vaciar la pantalla por una recarga fallida seria peor que dejar el catalogo viejo.
    expect(useCartStore.getState().catalog).toStrictEqual(CATALOG_PRODUCTS);
    expect(useCartStore.getState().status).toBe('error');
  });

  it('usa el mensaje inesperado cuando el fallo no es un ApiClientError', async () => {
    fetchCatalogDouble.mockRejectedValue(new TypeError('algo raro'));

    await useCartStore.getState().loadCatalog();

    expect(useCartStore.getState().status).toBe('error');
    expect(useCartStore.getState().errorMessage).toBe(
      'Ocurrio un error inesperado al cargar el catalogo.',
    );
  });

  it('limpia el mensaje de error de un intento anterior al reintentar', async () => {
    fetchCatalogDouble.mockRejectedValueOnce(new ApiClientError('Fallo el primer intento.'));
    await useCartStore.getState().loadCatalog();
    expect(useCartStore.getState().errorMessage).toBe('Fallo el primer intento.');

    fetchCatalogDouble.mockResolvedValueOnce(CATALOG_PRODUCTS);
    await useCartStore.getState().loadCatalog();

    expect(useCartStore.getState().status).toBe('ready');
    expect(useCartStore.getState().errorMessage).toBeNull();
  });

  it('no altera el carrito ya armado', async () => {
    givenItems({ [LAPTOP]: 2 });
    fetchCatalogDouble.mockResolvedValue(CATALOG_PRODUCTS);

    await useCartStore.getState().loadCatalog();

    expect(items()).toStrictEqual({ [LAPTOP]: 2 });
    expect(subtotal()).toBe(259800);
  });
});
