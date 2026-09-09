import { CATALOG_PRODUCTS, DISCOUNT_LABEL } from '@core/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchCatalog } from '../api/catalog.api';
import { confirmPurchase as requestConfirmation, requestPreview } from '../api/checkout.api';
import { ApiClientError } from '../api/http';

import { remainingStock, selectCartLines, selectSubtotalCents, useCartStore } from './cart.store';

import type { CartState } from './cart.store';
import type {
  CheckoutRequest,
  CheckoutTotals,
  DiscountLine,
  OrderConfirmation,
  OrderConfirmationItem,
  Product,
  StockShortage,
} from '@core/shared';

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
 * `ApiClientError` se importa de `http.ts`, que **no** se dobla: el `instanceof` del store
 * compara contra la misma clase que este spec lanza. Si la clase viviera en el modulo
 * doblado, un mock total daria dos clases distintas con el mismo nombre y el `instanceof`
 * fallaria en silencio, confundiendo la rama del mensaje traducido con la del mensaje
 * inesperado. El mock sigue siendo parcial para conservar el resto de `catalog.api`.
 *
 * `vi.fn<typeof ...>` y `vi.mocked` mantienen el doble tipado: cero `any` y cero
 * assertions, igual que en produccion (MF-R2.4).
 */
vi.mock('../api/catalog.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/catalog.api')>();
  return { ...actual, fetchCatalog: vi.fn<typeof actual.fetchCatalog>() };
});

/**
 * Mismo criterio para el Cliente_Api de checkout: se dobla el modulo, no `fetch`
 * (FK-R6.1). `checkout.api.spec.ts` ya cubre la frontera de red —rutas, verbo,
 * `Content-Type` y las guardas de runtime—, y repetirla aqui probaria dos veces lo mismo.
 * Lo que este archivo verifica es la maquina de estados del store: cuando pide el
 * desglose, cuando lo descarta por obsoleto y que hace con cada fallo.
 *
 * Es tambien la razon por la que el doble se declara con `vi.fn<typeof actual.X>()`: un
 * `mockResolvedValue` con algo que no es un `CheckoutTotals` no compila, asi que los
 * fixtures de este spec estan verificados por `tsc` contra el contrato compartido.
 */
vi.mock('../api/checkout.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/checkout.api')>();
  return {
    ...actual,
    requestPreview: vi.fn<typeof actual.requestPreview>(),
    confirmPurchase: vi.fn<typeof actual.confirmPurchase>(),
  };
});

const fetchCatalogDouble = vi.mocked(fetchCatalog);
const requestPreviewDouble = vi.mocked(requestPreview);
const requestConfirmationDouble = vi.mocked(requestConfirmation);

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

/**
 * Fixture canonico de `testing-standards.md`: 1 x `PROD-001` con `WELCOME2026`.
 *
 * Los montos se derivan a mano y **el store no los recalcula**: entran por el doble del
 * Cliente_Api y salen por `totals` tal cual. Estan aqui con los valores correctos porque
 * un fixture con aritmetica inventada convertiria cualquier afirmacion sobre el desglose
 * en ruido.
 *
 * Cascada exacta en micro-centavos: `12990` + `5845.5` + `16659.675` = `35495.175`, un
 * unico redondeo half-up al final -> `35495`. Reparto por mayor resto en las lineas: los
 * pisos suman `35494` y el centavo restante va al cupon, que tiene el mayor resto
 * (`.675`), asi que `12990 + 5845 + 16660 = 35495`.
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
  effectiveDiscountBps: 2_732,
  finalTotalCents: 94_405,
};

/**
 * Desglose de 2 x `PROD-001` con `WELCOME2026`. Existe para el caso de la respuesta
 * obsoleta: hacen falta **dos** desgloses distinguibles para poder afirmar cual gano.
 *
 * `25980` + `11691` + `33319.35` = `70990.35` -> `70990`. Aqui los pisos de las lineas ya
 * suman el total, asi que no hay centavo que repartir.
 */
const TOTALS_TWO_LAPTOPS: CheckoutTotals = {
  originalSubtotalCents: 259_800,
  lines: [
    {
      ...CATEGORY_LINE,
      baseAmountMicros: 259_800_000_000,
      baseAmountCents: 259_800,
      discountMicros: 25_980_000_000,
      discountCents: 25_980,
    },
    {
      ...VOLUME_LINE,
      baseAmountMicros: 233_820_000_000,
      baseAmountCents: 233_820,
      discountMicros: 11_691_000_000,
      discountCents: 11_691,
    },
    {
      ...COUPON_LINE,
      baseAmountMicros: 222_129_000_000,
      baseAmountCents: 222_129,
      discountMicros: 33_319_350_000,
      discountCents: 33_319,
    },
  ],
  rawDiscountMicros: 70_990_350_000,
  rawDiscountCents: 70_990,
  capCents: 90_930,
  capApplied: false,
  totalSavingsCents: 70_990,
  effectiveDiscountBps: 2_733,
  finalTotalCents: 188_810,
};

/**
 * Lo que devuelve `preview` para un cupon **no registrado o expirado**: `200` con la linea
 * `COUPON` en `applied: false` y el resto de la cascada intacto (D4 / FK-R2.6).
 *
 * `12990` + `5845.5` = `18835.5` -> `18836`. El centavo del reparto va a la linea de
 * volumen, que es la unica con resto (`.5`): `12990 + 5846 + 0 = 18836`.
 */
const TOTALS_WITHOUT_COUPON: CheckoutTotals = {
  originalSubtotalCents: 129_900,
  lines: [
    CATEGORY_LINE,
    { ...VOLUME_LINE, discountCents: 5_846 },
    {
      name: 'COUPON',
      label: DISCOUNT_LABEL.COUPON,
      applied: false,
      rateBps: 0,
      baseAmountMicros: 111_064_500_000,
      baseAmountCents: 111_064,
      discountMicros: 0,
      discountCents: 0,
    },
  ],
  rawDiscountMicros: 18_835_500_000,
  rawDiscountCents: 18_836,
  capCents: 45_465,
  capApplied: false,
  totalSavingsCents: 18_836,
  effectiveDiscountBps: 1_450,
  finalTotalCents: 111_064,
};

const CONFIRMED_ITEM: OrderConfirmationItem = {
  productId: LAPTOP,
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

/** Catalogo tal como lo devuelve el backend tras la compra: `PROD-001` con stock 4. */
const CATALOG_AFTER_PURCHASE: readonly Product[] = CATALOG_PRODUCTS.map((product) =>
  product.id === LAPTOP ? { ...product, stock: product.stock - 1 } : product,
);

const SHORTAGE: StockShortage = { productId: SABANAS, requested: 5, available: 3 };

/** El `409` de la validacion contra el snapshot del catalogo: trae `shortages`. */
const stockRejection = (): ApiClientError =>
  new ApiClientError('Alguna linea del carrito supera el stock disponible.', 'INSUFFICIENT_STOCK', {
    shortages: [SHORTAGE],
  });

const resetStore = (catalog: readonly Product[] = CATALOG_PRODUCTS): void => {
  useCartStore.setState({
    catalog,
    items: {},
    status: 'idle',
    errorMessage: null,
    couponDraft: '',
    appliedCoupon: null,
    totals: null,
    previewStatus: 'idle',
    previewError: null,
    confirmation: null,
    purchaseStatus: 'idle',
    purchaseError: null,
    shortages: [],
  });
};

const store = (): CartState => useCartStore.getState();

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

/**
 * Ultima peticion de desglose recibida por el doble. Lanza en vez de devolver `undefined`
 * para que un fallo de "no se pidio nada" salga como tal y no como un `toStrictEqual`
 * contra un valor ausente.
 */
const lastPreviewRequest = (): CheckoutRequest => {
  const call = requestPreviewDouble.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('No se pidio ningun desglose.');
  }
  return call[0];
};

const lastPurchaseRequest = (): CheckoutRequest => {
  const call = requestConfirmationDouble.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('No se envio ninguna compra.');
  }
  return call[0];
};

/**
 * Espera a que el desglose en vuelo aterrice.
 *
 * `applyCoupon`, `add`, `decrement` y `remove` son sincronas y disparan la peticion como
 * promesa flotante —la pantalla no espera a nadie—, asi que el test no tiene una promesa
 * que encadenar. Se espera sobre el **estado observable** en lugar de contar microtasks:
 * un `await Promise.resolve()` repetido n veces se rompe en cuanto la accion gane un
 * `await` mas.
 *
 * Con el carrito vacio no se pidio nada y `previewStatus` sigue en `'idle'`, asi que el
 * helper resuelve de inmediato y sirve igual a los casos que afirman la ausencia de
 * peticion.
 */
const settledPreview = async (): Promise<void> => {
  await vi.waitFor(() => {
    expect(store().previewStatus).not.toBe('loading');
  });
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Promesa cuya resolucion decide el test. Es lo que permite invertir el orden de llegada
 * de dos peticiones de desglose, que es el bug que el contador de secuencia previene.
 *
 * Los handlers se guardan en un objeto con propiedades opcionales y se invocan con `?.()`
 * en lugar de declararlos con una assertion de asignacion definida: el ejecutor de
 * `Promise` corre de forma sincrona, asi que ya estan puestos cuando alguien llama, y de
 * este modo no hace falta silenciar al compilador.
 */
const deferred = <T>(): Deferred<T> => {
  const handlers: {
    resolve?: (value: T) => void;
    reject?: (error: unknown) => void;
  } = {};
  const promise = new Promise<T>((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  return {
    promise,
    resolve: (value: T): void => {
      handlers.resolve?.(value);
    },
    reject: (error: unknown): void => {
      handlers.reject?.(error);
    },
  };
};

beforeEach(() => {
  fetchCatalogDouble.mockReset();
  requestPreviewDouble.mockReset();
  requestConfirmationDouble.mockReset();
  resetStore();
  // Invalida las peticiones que un test anterior pudiera haber dejado en vuelo: la rama
  // del carrito vacio avanza el contador de secuencia sin tocar la red, de modo que una
  // respuesta rezagada se descarta en lugar de contaminar el test que viene.
  void useCartStore.getState().refreshPreview();
  requestPreviewDouble.mockResolvedValue(TOTALS);
  requestConfirmationDouble.mockResolvedValue(CONFIRMATION);
  fetchCatalogDouble.mockResolvedValue(CATALOG_PRODUCTS);
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

describe('el tope del stock disponible (FC-R6.4, I5)', () => {
  it('agregar PROD-005 seis veces con stock 3 se detiene en 3 y subtotal 17700', () => {
    // El carrito no deja construir una linea que ya se sabe invalida: `add` se detiene en
    // el disponible. El backend sigue revalidando sobre el stock real.
    addTimes(SABANAS, 6);

    expect(items()).toStrictEqual({ [SABANAS]: 3 });
    expect(lines()[0]?.product.stock).toBe(3);
    // 5900 x 3 = 17700
    expect(subtotal()).toBe(17700);
  });

  it('no marca error ni cambia el status al intentar pasarse del stock', () => {
    // Llegar al tope no es un fallo: es el carrito diciendo que ahi se acaba.
    addTimes(SABANAS, 6);

    expect(useCartStore.getState().status).toBe('idle');
    expect(useCartStore.getState().errorMessage).toBeNull();
  });

  it('el add que no cabe no pide desglose', () => {
    addTimes(SABANAS, 3);
    requestPreviewDouble.mockClear();

    useCartStore.getState().add(SABANAS);

    // Una accion que no cambio el carrito no produce peticion, igual que `decrement`
    // sobre un producto ausente.
    expect(requestPreviewDouble).not.toHaveBeenCalled();
  });

  it('un producto que el catalogo no conoce no entra al carrito', () => {
    useCartStore.getState().add('PROD-999');

    expect(items()).toStrictEqual({});
  });

  it('remainingStock descuenta lo que ya esta en el carrito y no baja de cero', () => {
    expect(remainingStock(3, 0)).toBe(3);
    expect(remainingStock(3, 3)).toBe(0);
    // Carrito por encima del disponible tras recargar el catalogo: no queda nada, no un
    // negativo.
    expect(remainingStock(3, 6)).toBe(0);
    expect(remainingStock(0, 0)).toBe(0);
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

describe('disparo del desglose (FK-R2.3, FK-R6.2)', () => {
  it('applyCoupon pide el desglose con el cupon ya aplicado', async () => {
    givenItems({ [LAPTOP]: 1 });
    store().setCouponDraft('WELCOME2026');

    store().applyCoupon();
    await settledPreview();

    expect(store().appliedCoupon).toBe('WELCOME2026');
    expect(requestPreviewDouble).toHaveBeenCalledTimes(1);
    expect(lastPreviewRequest()).toStrictEqual({
      items: [{ productId: LAPTOP, quantity: 1 }],
      couponCode: 'WELCOME2026',
    });
    expect(store().totals).toStrictEqual(TOTALS);
    expect(store().previewStatus).toBe('ready');
    expect(store().previewError).toBeNull();
  });

  it('add pide el desglose, y sin cupon la propiedad esta ausente de la peticion', async () => {
    store().add(TECLADO);
    await settledPreview();

    expect(requestPreviewDouble).toHaveBeenCalledTimes(1);
    expect(lastPreviewRequest().items).toStrictEqual([{ productId: TECLADO, quantity: 1 }]);
    // "Sin cupon" es la AUSENCIA de la propiedad, no `couponCode: undefined`.
    expect('couponCode' in lastPreviewRequest()).toBe(false);
    expect(store().totals).toStrictEqual(TOTALS);
  });

  it('add envia las cantidades actualizadas, no las anteriores', async () => {
    givenItems({ [LAPTOP]: 1 });

    store().add(LAPTOP);
    await settledPreview();

    expect(lastPreviewRequest().items).toStrictEqual([{ productId: LAPTOP, quantity: 2 }]);
  });

  it('decrement pide el desglose con la linea ya rebajada', async () => {
    givenItems({ [LAPTOP]: 2 });

    store().decrement(LAPTOP);
    await settledPreview();

    expect(requestPreviewDouble).toHaveBeenCalledTimes(1);
    expect(lastPreviewRequest().items).toStrictEqual([{ productId: LAPTOP, quantity: 1 }]);
  });

  it('remove pide el desglose con la linea ya eliminada', async () => {
    givenItems({ [LAPTOP]: 1, [CAMISETA]: 2 });

    store().remove(LAPTOP);
    await settledPreview();

    expect(requestPreviewDouble).toHaveBeenCalledTimes(1);
    expect(lastPreviewRequest().items).toStrictEqual([{ productId: CAMISETA, quantity: 2 }]);
  });

  it('una accion que no cambio el carrito no pide desglose', async () => {
    givenItems({ [CAMISETA]: 1 });

    store().decrement(LAPTOP);
    store().remove(SABANAS);
    await settledPreview();

    expect(requestPreviewDouble).not.toHaveBeenCalled();
  });

  it('marca previewStatus loading mientras la peticion esta en vuelo (FK-R3.5)', async () => {
    const pending = deferred<CheckoutTotals>();
    requestPreviewDouble.mockReturnValue(pending.promise);
    givenItems({ [LAPTOP]: 1 });

    const inFlight = store().refreshPreview();
    expect(store().previewStatus).toBe('loading');

    pending.resolve(TOTALS);
    await inFlight;
    expect(store().previewStatus).toBe('ready');
  });

  it('expone los enteros de CheckoutTotals tal como llegan, sin recalcular (FK-R2.7)', async () => {
    givenItems({ [LAPTOP]: 1 });

    await store().refreshPreview();

    // Ni un redondeo propio ni un total derivado: el mismo objeto que devolvio el backend.
    expect(store().totals).toStrictEqual(TOTALS);
    expect(store().totals?.rawDiscountCents).toBe(35_495);
    expect(store().totals?.totalSavingsCents).toBe(35_495);
    expect(store().totals?.finalTotalCents).toBe(94_405);
    expect(store().totals?.capApplied).toBe(false);
  });
});

describe('carrito vacio: ni peticion ni desglose conservado (FK-R2.4, FK-R6.2)', () => {
  it('refreshPreview sobre un carrito vacio no llega a la red', async () => {
    await store().refreshPreview();

    expect(requestPreviewDouble).not.toHaveBeenCalled();
    expect(store().totals).toBeNull();
    expect(store().previewStatus).toBe('idle');
  });

  it('el remove de la ultima linea devuelve totals a null en vez de conservarlo', async () => {
    givenItems({ [LAPTOP]: 1 });
    await store().refreshPreview();
    expect(store().totals).toStrictEqual(TOTALS);

    store().remove(LAPTOP);
    await settledPreview();

    // Sin segunda peticion: el desglose de un carrito sin lineas no se pide, y dejar el
    // anterior mostraria el precio de un carrito que ya no existe.
    expect(requestPreviewDouble).toHaveBeenCalledTimes(1);
    expect(store().totals).toBeNull();
    expect(store().previewStatus).toBe('idle');
    expect(store().previewError).toBeNull();
  });

  it('el decrement que vacia el carrito tambien devuelve totals a null', async () => {
    givenItems({ [CAMISETA]: 1 });
    await store().refreshPreview();

    store().decrement(CAMISETA);
    await settledPreview();

    expect(items()).toStrictEqual({});
    expect(store().totals).toBeNull();
  });

  it('vaciar el carrito anula una peticion en vuelo lanzada cuando aun habia lineas', async () => {
    const pending = deferred<CheckoutTotals>();
    requestPreviewDouble.mockReturnValue(pending.promise);
    givenItems({ [LAPTOP]: 1 });
    const inFlight = store().refreshPreview();

    store().remove(LAPTOP);
    pending.resolve(TOTALS);
    await inFlight;

    // La rama del carrito vacio avanzo el contador, asi que la respuesta rezagada no
    // puede resucitar el desglose del carrito anterior.
    expect(store().totals).toBeNull();
    expect(store().previewStatus).toBe('idle');
  });
});

describe('borrador y cupon aplicado son dos campos (FK-R2.2)', () => {
  it('teclear en el borrador no dispara ninguna peticion', async () => {
    givenItems({ [LAPTOP]: 1 });

    store().setCouponDraft('W');
    store().setCouponDraft('WE');
    store().setCouponDraft('WELCOME2026');
    await settledPreview();

    expect(store().couponDraft).toBe('WELCOME2026');
    expect(store().appliedCoupon).toBeNull();
    expect(requestPreviewDouble).not.toHaveBeenCalled();
    expect(store().totals).toBeNull();
  });

  it('applyCoupon recorta los espacios del borrador', async () => {
    givenItems({ [LAPTOP]: 1 });
    store().setCouponDraft('  WELCOME2026  ');

    store().applyCoupon();
    await settledPreview();

    expect(store().appliedCoupon).toBe('WELCOME2026');
    expect(lastPreviewRequest().couponCode).toBe('WELCOME2026');
  });

  it('un borrador en blanco retira el cupon y pide el desglose sin la propiedad', async () => {
    givenItems({ [LAPTOP]: 1 });
    useCartStore.setState({ appliedCoupon: 'WELCOME2026', couponDraft: '   ' });

    store().applyCoupon();
    await settledPreview();

    // `couponCode: ''` no es un codigo: retirar el cupon es enviar la peticion sin el.
    expect(store().appliedCoupon).toBeNull();
    expect('couponCode' in lastPreviewRequest()).toBe(false);
  });

  it('applyCoupon con el carrito vacio guarda el cupon y no pide nada', async () => {
    store().setCouponDraft('WELCOME2026');

    store().applyCoupon();
    await settledPreview();

    expect(store().appliedCoupon).toBe('WELCOME2026');
    expect(requestPreviewDouble).not.toHaveBeenCalled();
    expect(store().totals).toBeNull();
  });
});

describe('respuesta obsoleta: gana la mas reciente (FK-R2.5, FK-R6.3, I3)', () => {
  it('la primera peticion resuelve en ultimo lugar y su desglose se descarta', async () => {
    const first = deferred<CheckoutTotals>();
    const second = deferred<CheckoutTotals>();
    requestPreviewDouble.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    // Pulsar `+` dos veces seguidas: dos peticiones en vuelo.
    givenItems({ [LAPTOP]: 1 });
    const inFlightFirst = store().refreshPreview();
    givenItems({ [LAPTOP]: 2 });
    const inFlightSecond = store().refreshPreview();

    second.resolve(TOTALS_TWO_LAPTOPS);
    await inFlightSecond;
    expect(store().totals).toStrictEqual(TOTALS_TWO_LAPTOPS);

    first.resolve(TOTALS);
    await inFlightFirst;

    // El desglose del carrito de una laptop llego tarde y no pisa al vigente.
    expect(store().totals).toStrictEqual(TOTALS_TWO_LAPTOPS);
    expect(store().totals?.originalSubtotalCents).toBe(259_800);
    expect(store().previewStatus).toBe('ready');
  });

  it('el fallo de una peticion obsoleta no ensucia el desglose vigente', async () => {
    const first = deferred<CheckoutTotals>();
    const second = deferred<CheckoutTotals>();
    requestPreviewDouble.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    givenItems({ [LAPTOP]: 1 });
    const inFlightFirst = store().refreshPreview();
    givenItems({ [LAPTOP]: 2 });
    const inFlightSecond = store().refreshPreview();

    second.resolve(TOTALS_TWO_LAPTOPS);
    await inFlightSecond;

    first.reject(new ApiClientError('Se cayo la red.'));
    await inFlightFirst;

    expect(store().previewStatus).toBe('ready');
    expect(store().previewError).toBeNull();
    expect(store().totals).toStrictEqual(TOTALS_TWO_LAPTOPS);
  });
});

describe('cupon no registrado o expirado: ruta satisfactoria (FK-R2.6, FK-R6.4, I4)', () => {
  it('deja el desglose visible con la linea de cupon no aplicada y sin error', async () => {
    requestPreviewDouble.mockResolvedValue(TOTALS_WITHOUT_COUPON);
    givenItems({ [LAPTOP]: 1 });
    store().setCouponDraft('SUMMER2024');

    store().applyCoupon();
    await settledPreview();

    // El backend resolvio el codigo a "sin cupon" y respondio 200: no hay rama de error.
    expect(store().previewStatus).toBe('ready');
    expect(store().previewError).toBeNull();
    expect(store().totals).toStrictEqual(TOTALS_WITHOUT_COUPON);
    expect(store().totals?.lines).toHaveLength(3);
    expect(store().totals?.lines[2]?.applied).toBe(false);
    expect(store().totals?.lines[2]?.discountCents).toBe(0);
    // El codigo tecleado se conserva aplicado: la senal de que no valia es la linea.
    expect(store().appliedCoupon).toBe('SUMMER2024');
  });

  it('un codigo desconocido sigue enviandose al backend, que es quien lo resuelve', async () => {
    requestPreviewDouble.mockResolvedValue(TOTALS_WITHOUT_COUPON);
    givenItems({ [LAPTOP]: 1 });
    store().setCouponDraft('NO_EXISTE');

    store().applyCoupon();
    await settledPreview();

    // Validar el catalogo de cupones en el cliente seria la primera cosa que se
    // desincroniza con el backend.
    expect(lastPreviewRequest().couponCode).toBe('NO_EXISTE');
    expect(store().previewError).toBeNull();
  });
});

describe('fallo del desglose (FK-R3.5)', () => {
  it('guarda el mensaje del ApiClientError y no toca el carrito', async () => {
    requestPreviewDouble.mockRejectedValue(new ApiClientError('El carrito no tiene lineas.'));
    givenItems({ [LAPTOP]: 2 });

    await store().refreshPreview();

    expect(store().previewStatus).toBe('error');
    expect(store().previewError).toBe('El carrito no tiene lineas.');
    expect(items()).toStrictEqual({ [LAPTOP]: 2 });
    expect(subtotal()).toBe(259_800);
  });

  it('conserva el desglose anterior junto al aviso del fallo', async () => {
    givenItems({ [LAPTOP]: 1 });
    await store().refreshPreview();

    requestPreviewDouble.mockRejectedValue(new ApiClientError('Se cayo la red.'));
    store().add(LAPTOP);
    await settledPreview();

    // Borrar los montos por un fallo de red dejaria la pantalla mas pobre, no mas segura.
    expect(store().totals).toStrictEqual(TOTALS);
    expect(store().previewStatus).toBe('error');
    expect(store().previewError).toBe('Se cayo la red.');
  });

  it('usa el mensaje inesperado cuando el fallo no es un ApiClientError', async () => {
    requestPreviewDouble.mockRejectedValue(new TypeError('algo raro'));
    givenItems({ [LAPTOP]: 1 });

    await store().refreshPreview();

    expect(store().previewStatus).toBe('error');
    expect(store().previewError).toBe('Ocurrio un error inesperado al calcular el desglose.');
  });

  it('limpia el aviso de un intento anterior al recalcular con exito', async () => {
    requestPreviewDouble.mockRejectedValueOnce(new ApiClientError('Fallo el primer intento.'));
    givenItems({ [LAPTOP]: 1 });
    await store().refreshPreview();
    expect(store().previewError).toBe('Fallo el primer intento.');

    await store().refreshPreview();

    expect(store().previewStatus).toBe('ready');
    expect(store().previewError).toBeNull();
    expect(store().totals).toStrictEqual(TOTALS);
  });
});

describe('confirmPurchase: compra completada (FK-R5.3, FK-R6.6)', () => {
  it('guarda la confirmacion, vacia el carrito y recarga el catalogo', async () => {
    fetchCatalogDouble.mockResolvedValue(CATALOG_AFTER_PURCHASE);
    givenItems({ [LAPTOP]: 1 });
    useCartStore.setState({ appliedCoupon: 'WELCOME2026' });

    await store().confirmPurchase();

    expect(store().confirmation).toStrictEqual(CONFIRMATION);
    expect(store().purchaseStatus).toBe('done');
    expect(store().purchaseError).toBeNull();
    expect(store().shortages).toStrictEqual([]);
    expect(items()).toStrictEqual({});
    // La recarga es lo que hace visible el stock ya decrementado.
    expect(fetchCatalogDouble).toHaveBeenCalledTimes(1);
    expect(store().catalog.find((product) => product.id === LAPTOP)?.stock).toBe(4);
  });

  it('el carrito vacio tras la compra deja totals en null sin pedir desglose', async () => {
    givenItems({ [LAPTOP]: 1 });
    await store().refreshPreview();
    expect(store().totals).toStrictEqual(TOTALS);

    await store().confirmPurchase();

    expect(store().totals).toBeNull();
    expect(store().previewStatus).toBe('idle');
    // Una sola peticion de desglose en todo el recorrido: la del carrito con lineas.
    expect(requestPreviewDouble).toHaveBeenCalledTimes(1);
  });

  it('envia solo lineas y cupon, sin ningun monto (FK-R5.6)', async () => {
    givenItems({ [LAPTOP]: 1, [CAMISETA]: 3 });
    store().setCouponDraft('WELCOME2026');
    store().applyCoupon();
    await settledPreview();

    await store().confirmPurchase();

    expect(lastPurchaseRequest()).toStrictEqual({
      items: [
        { productId: LAPTOP, quantity: 1 },
        { productId: CAMISETA, quantity: 3 },
      ],
      couponCode: 'WELCOME2026',
    });
    // `Object.keys` devuelve un arreglo nuevo, asi que ordenarlo no muta la peticion.
    expect(Object.keys(lastPurchaseRequest()).sort()).toStrictEqual(['couponCode', 'items']);
  });

  it('marca purchaseStatus sending mientras la compra esta en vuelo (FK-R5.1)', async () => {
    const pending = deferred<OrderConfirmation>();
    requestConfirmationDouble.mockReturnValue(pending.promise);
    givenItems({ [LAPTOP]: 1 });

    const inFlight = store().confirmPurchase();
    expect(store().purchaseStatus).toBe('sending');
    expect(store().confirmation).toBeNull();

    pending.resolve(CONFIRMATION);
    await inFlight;
    expect(store().purchaseStatus).toBe('done');
  });

  it('conserva los totales de la orden tal como llegan, sin recalcular (FK-R5.2)', async () => {
    givenItems({ [LAPTOP]: 1 });

    await store().confirmPurchase();

    expect(store().confirmation?.totals).toStrictEqual(TOTALS);
    expect(store().confirmation?.totals.finalTotalCents).toBe(94_405);
    expect(store().confirmation?.items[0]?.lineTotalCents).toBe(129_900);
    expect(store().confirmation?.createdAt).toBe('2026-01-15T10:30:00.000Z');
  });

  it('no llega a la red con el carrito vacio', async () => {
    await store().confirmPurchase();

    expect(requestConfirmationDouble).not.toHaveBeenCalled();
    expect(store().purchaseStatus).toBe('idle');
    expect(store().confirmation).toBeNull();
  });
});

describe('confirmPurchase: compra rechazada (FK-R5.4, FK-R5.5, FK-R6.6, I5)', () => {
  it('el 409 de stock guarda las shortages y conserva el carrito', async () => {
    requestConfirmationDouble.mockRejectedValue(stockRejection());
    givenItems({ [SABANAS]: 5 });
    useCartStore.setState({ appliedCoupon: 'WELCOME2026' });

    await store().confirmPurchase();

    expect(store().purchaseStatus).toBe('error');
    expect(store().purchaseError).toBe('Alguna linea del carrito supera el stock disponible.');
    expect(store().shortages).toStrictEqual([{ productId: SABANAS, requested: 5, available: 3 }]);
    expect(store().confirmation).toBeNull();
    // El carrito y el cupon quedan intactos para que el usuario corrija y reintente.
    expect(items()).toStrictEqual({ [SABANAS]: 5 });
    expect(store().appliedCoupon).toBe('WELCOME2026');
    expect(fetchCatalogDouble).not.toHaveBeenCalled();
  });

  it('el 409 de la guarda del decremento no trae shortages y se resuelve a la lista vacia', async () => {
    // El compare-and-swap sabe que la fila ya no cumplia la condicion, pero no cuanto
    // stock quedaba: sus details son solo los identificadores en disputa.
    requestConfirmationDouble.mockRejectedValue(
      new ApiClientError(
        'El stock cambio mientras se confirmaba la compra.',
        'INSUFFICIENT_STOCK',
        { contendedProductIds: [SABANAS] },
      ),
    );
    givenItems({ [SABANAS]: 3 });

    await store().confirmPurchase();

    expect(store().purchaseError).toBe('El stock cambio mientras se confirmaba la compra.');
    expect(store().shortages).toStrictEqual([]);
    expect(items()).toStrictEqual({ [SABANAS]: 3 });
  });

  it('descarta las lineas deficitarias ilegibles y conserva las que si respetan la forma', async () => {
    requestConfirmationDouble.mockRejectedValue(
      new ApiClientError('Alguna linea del carrito supera el stock disponible.', 'INSUFFICIENT_STOCK', {
        shortages: [SHORTAGE, { productId: LAMPARA }, 'PROD-001'],
      }),
    );
    givenItems({ [SABANAS]: 5 });

    await store().confirmPurchase();

    // Una linea ilegible no es razon para ocultar las que si se entienden.
    expect(store().shortages).toStrictEqual([SHORTAGE]);
  });

  it('ignora unos details cuyo shortages no es un arreglo', async () => {
    requestConfirmationDouble.mockRejectedValue(
      new ApiClientError('Stock insuficiente.', 'INSUFFICIENT_STOCK', { shortages: SABANAS }),
    );
    givenItems({ [SABANAS]: 5 });

    await store().confirmPurchase();

    expect(store().shortages).toStrictEqual([]);
    expect(store().purchaseError).toBe('Stock insuficiente.');
  });

  it('un error tipado sin details deja las shortages vacias', async () => {
    requestConfirmationDouble.mockRejectedValue(
      new ApiClientError('El producto no existe.', 'PRODUCT_NOT_FOUND'),
    );
    givenItems({ [LAPTOP]: 1 });

    await store().confirmPurchase();

    expect(store().purchaseError).toBe('El producto no existe.');
    expect(store().shortages).toStrictEqual([]);
    expect(items()).toStrictEqual({ [LAPTOP]: 1 });
  });

  it('usa el mensaje inesperado cuando el fallo no es un ApiClientError', async () => {
    requestConfirmationDouble.mockRejectedValue(new TypeError('algo raro'));
    givenItems({ [LAPTOP]: 1 });

    await store().confirmPurchase();

    expect(store().purchaseStatus).toBe('error');
    expect(store().purchaseError).toBe('Ocurrio un error inesperado al confirmar la compra.');
    expect(store().shortages).toStrictEqual([]);
    expect(items()).toStrictEqual({ [LAPTOP]: 1 });
  });

  it('un reintento con exito limpia el mensaje y las shortages del rechazo anterior', async () => {
    requestConfirmationDouble.mockRejectedValueOnce(stockRejection());
    givenItems({ [SABANAS]: 5 });
    await store().confirmPurchase();
    expect(store().shortages).toHaveLength(1);

    givenItems({ [SABANAS]: 3 });
    await store().confirmPurchase();

    expect(store().purchaseStatus).toBe('done');
    expect(store().purchaseError).toBeNull();
    expect(store().shortages).toStrictEqual([]);
    expect(store().confirmation).toStrictEqual(CONFIRMATION);
  });
});
