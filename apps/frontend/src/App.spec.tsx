import { CATALOG_PRODUCTS, DISCOUNT_LABEL, formatCents } from '@core/shared';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { fetchCatalog } from './api/catalog.api';
import { confirmPurchase as requestConfirmation, requestPreview } from './api/checkout.api';
import { ApiClientError } from './api/http';
import { useCartStore } from './store/cart.store';

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
 * Suite de la Pantalla_Carrito (FC-R6.5).
 *
 * Dos decisiones gobiernan todo el archivo:
 *
 * 1. **El doble es del Cliente_Api, no de `fetch`.** `catalog.api.spec.ts` ya cubre la
 *    frontera de red; lo que aqui interesa es la pantalla, asi que se sustituye la unica
 *    dependencia externa que el store tiene. `ApiClientError` se importa de `http.ts`,
 *    que **no** se dobla: el `instanceof` de `loadCatalog` compara contra la misma clase
 *    que este spec lanza. Dos clases homonimas dejarian el `instanceof` fallando en
 *    silencio, confundiendo el mensaje del error con el generico de fallo inesperado. El
 *    mock de `catalog.api` sigue siendo parcial. `vi.fn<typeof ...>` y `vi.mocked`
 *    mantienen el doble tipado: cero `any` y cero assertions (MF-R2.4).
 *
 * 2. **Se afirma sobre el texto renderizado, nunca sobre el estado del store.** Ningun
 *    caso lee `useCartStore.getState()` para verificar un resultado —`cart.store.spec.ts`
 *    ya hace eso, sin renderizar—. Aqui la afirmacion es siempre el DOM, porque lo que
 *    esta bajo prueba es I6: que el entero del selector llega a pantalla formateado con
 *    `formatCents` y sin que la UI lo reformatee por su cuenta. Un test que comparara
 *    `items` o `selectSubtotalCents` volveria a probar el store y dejaria el render sin
 *    cubrir, que es precisamente el hueco que esta suite existe para cerrar.
 *
 * Los montos esperados se derivan a mano del catalogo canonico y se envuelven en
 * `formatCents`, que es la unica funcion autorizada a producir el texto del monto.
 */
vi.mock('./api/catalog.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/catalog.api')>();
  return { ...actual, fetchCatalog: vi.fn<typeof actual.fetchCatalog>() };
});

/**
 * Mismo criterio para el Cliente_Api de checkout (FK-R6.1): se dobla el modulo, no `fetch`.
 * `checkout.api.spec.ts` ya cubre la frontera de red —rutas, verbo, `Content-Type` y las
 * guardas de runtime— y `cart.store.spec.ts` cubre la maquina de estados sin renderizar. Lo
 * que esta suite verifica es lo que la **pantalla** hace con lo que llega: que las tres
 * lineas se pinten, que la alerta aparezca si y solo si el backend lo dice, y que el
 * comprobante y el rechazo por stock se lean.
 *
 * `vi.fn<typeof actual.X>()` deja los fixtures verificados por `tsc` contra el contrato
 * compartido: un `mockResolvedValue` que no sea un `CheckoutTotals` o un
 * `OrderConfirmation` no compila. Cero `any` y cero assertions.
 */
vi.mock('./api/checkout.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api/checkout.api')>();
  return {
    ...actual,
    requestPreview: vi.fn<typeof actual.requestPreview>(),
    confirmPurchase: vi.fn<typeof actual.confirmPurchase>(),
  };
});

const fetchCatalogDouble = vi.mocked(fetchCatalog);
const requestPreviewDouble = vi.mocked(requestPreview);
const requestConfirmationDouble = vi.mocked(requestConfirmation);

/** Nombres del catalogo canonico, tal como la pantalla los pinta. */
const LAPTOP = 'Laptop Pro 14"'; //          Tecnologia, 129900, stock 5
const AURICULARES = 'Auriculares Bluetooth'; // Tecnologia,   7990, stock 12
const TECLADO = 'Teclado Mecánico'; //       Tecnologia,   4550, stock 8
const LAMPARA = 'Lámpara de Escritorio'; //  Hogar,        3200, stock 15
const SABANAS = 'Juego de Sábanas'; //       Hogar,        5900, stock 3
const CAMISETA = 'Camiseta Básica'; //       Ropa,         1990, stock 20

/** Textos de UI fijados a proposito: son contrato de pantalla, no detalle interno. */
const EMPTY_CART = 'El carrito está vacío. Agrega productos del catálogo para empezar.';
const LOADING = 'Cargando catálogo…';
const NO_BREAKDOWN = 'Agrega productos al carrito para ver el desglose de descuentos.';
const RECALCULATING = 'Recalculando el desglose…';
const CONFIRM_LABEL = 'Confirmar la compra';
const SENDING = 'Confirmando la compra…';
const NO_PURCHASE = 'Confirma la compra para ver el comprobante de tu orden.';
const SHORTAGES_TITLE = 'Líneas que superan el stock disponible:';

/**
 * Redaccion de la Alerta_Tope, **escrita a mano aqui** y no importada de `CapAlert`
 * (FK-R4.2 / I2).
 *
 * Es deliberado: importar `CAP_ALERT_TEXT` compararia la constante contra si misma y
 * cualquier cambio de redaccion pasaria el test en silencio. Con el literal duplicado en el
 * spec, el texto del componente esta afirmado **caracter por caracter** contra
 * `product-rules.md`, y tocarlo rompe la prueba, que es exactamente su proposito.
 */
const CAP_ALERT_TEXT = '¡Enhorabuena! Has alcanzado el límite máximo de ahorro permitido (35%)';

/** Identificadores del catalogo canonico, para los fixtures de la orden y del `409`. */
const LAPTOP_ID = 'PROD-001'; //  129900, stock 5
const SABANAS_ID = 'PROD-005'; //   5900, stock 3
const CAMISETA_ID = 'PROD-006'; //  1990, stock 20

/**
 * ## Fixtures del desglose
 *
 * Son **respuestas del backend**, no calculos de esta suite: entran por el doble del
 * Cliente_Api y salen a pantalla tal cual. Los montos se derivan a mano con la politica de
 * `product-rules.md` —cascada exacta en micro-centavos, un unico redondeo half-up al final,
 * floor en el tope y reparto por mayor resto en las lineas— porque un fixture con
 * aritmetica inventada convertiria cualquier afirmacion sobre el desglose en ruido.
 *
 * Fixture canonico: 1 x `PROD-001` con `WELCOME2026`. `12990` + `5845.5` + `16659.675` =
 * `35495.175` -> `35495`. Los pisos de las lineas suman `35494` y el centavo restante va al
 * cupon, que tiene el mayor resto (`.675`): `12990 + 5845 + 16660 = 35495`.
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

/**
 * Lo que devuelve `preview` para un cupon **no registrado o expirado**: `200` con la linea
 * `COUPON` en `applied: false` y el resto de la cascada intacto (D4 / FK-R2.6).
 *
 * `12990` + `5845.5` = `18835.5` -> `18836`. El centavo del reparto va a la linea de
 * volumen, la unica con resto: `12990 + 5846 + 0 = 18836`.
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
  capAdjustmentCents: 0,
  effectiveDiscountBps: 1_450,
  finalTotalCents: 111_064,
};

/**
 * Tope **activado**: 1 x `PROD-001` con el cupon de demo `DEMOCAP50`, que es el unico
 * camino que dispara la alerta —con las reglas literales el maximo alcanzable es 27.325%,
 * asi que el tope es un invariante y no un camino de datos reales—.
 *
 * `12990` + `5845.5` + `55532.25` = `74367.75` -> `74368`. `capCents = floor(129900 x 3500
 * / 10000) = 45465`, y `74368 > 45465`, asi que `capApplied` es `true` y el ahorro se trunca
 * en `45465`. Las lineas siguen sumando `rawDiscountCents`: los pisos dan `74367` y el
 * centavo va a volumen, que tiene el mayor resto (`.5` contra `.25`).
 */
const TOTALS_CAPPED: CheckoutTotals = {
  originalSubtotalCents: 129_900,
  lines: [
    CATEGORY_LINE,
    { ...VOLUME_LINE, discountCents: 5_846 },
    {
      ...COUPON_LINE,
      rateBps: 5000,
      discountMicros: 55_532_250_000,
      discountCents: 55_532,
    },
  ],
  rawDiscountMicros: 74_367_750_000,
  rawDiscountCents: 74_368,
  capCents: 45_465,
  capApplied: true,
  totalSavingsCents: 45_465,
  capAdjustmentCents: 28_903,
  effectiveDiscountBps: 3_500,
  finalTotalCents: 84_435,
};

/**
 * El caso que separa "alcanzar el 35%" de "haber sido truncado": 2 x `PROD-006` con un
 * cupon del 35%. Sin `Tecnologia` no aplica la categoria y con `3980` centavos no se supera
 * el umbral de volumen, asi que el cupon opera sobre el subtotal original: `3980 x 3500 /
 * 10000 = 1393` exacto, que es **igual** a `capCents = floor(3980 x 3500 / 10000) = 1393`.
 *
 * `rawDiscountCents === capCents` y no lo supera, asi que **no hubo truncamiento** y
 * `capApplied` es `false` (FK-R4.1). El descuento efectivo es exactamente `3500` bps: una
 * UI que derivara la alerta comparando el porcentaje con el 35%, o el ahorro con el tope,
 * la mostraria aqui. Es el fixture que hace fallar esa derivacion.
 */
const TOTALS_EXACTLY_AT_CAP: CheckoutTotals = {
  originalSubtotalCents: 3_980,
  lines: [
    {
      ...CATEGORY_LINE,
      applied: false,
      rateBps: 0,
      baseAmountMicros: 3_980_000_000,
      baseAmountCents: 3_980,
      discountMicros: 0,
      discountCents: 0,
    },
    {
      ...VOLUME_LINE,
      applied: false,
      rateBps: 0,
      baseAmountMicros: 3_980_000_000,
      baseAmountCents: 3_980,
      discountMicros: 0,
      discountCents: 0,
    },
    {
      ...COUPON_LINE,
      rateBps: 3500,
      baseAmountMicros: 3_980_000_000,
      baseAmountCents: 3_980,
      discountMicros: 1_393_000_000,
      discountCents: 1_393,
    },
  ],
  rawDiscountMicros: 1_393_000_000,
  rawDiscountCents: 1_393,
  capCents: 1_393,
  capApplied: false,
  totalSavingsCents: 1_393,
  capAdjustmentCents: 0,
  effectiveDiscountBps: 3_500,
  finalTotalCents: 2_587,
};

/** Orden persistida de 1 x `PROD-001` con `WELCOME2026`: montos congelados en la fila. */
const CONFIRMED_ITEM: OrderConfirmationItem = {
  productId: LAPTOP_ID,
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

/**
 * Orden cerrada **sin cupon**: `couponCode` es opcional *ausente* en el contrato, asi que
 * el comprobante no debe pintar la fila del cupon.
 */
const CONFIRMATION_WITHOUT_COUPON: OrderConfirmation = {
  orderId: 'ORD-0002',
  createdAt: '2026-02-01T08:00:00.000Z',
  items: [{ ...CONFIRMED_ITEM, productId: CAMISETA_ID, name: 'Camiseta Básica' }],
  totals: TOTALS_WITHOUT_COUPON,
};

/** Catalogo tal como lo devuelve el backend tras la compra: `PROD-001` con stock 4. */
const CATALOG_AFTER_PURCHASE: readonly Product[] = CATALOG_PRODUCTS.map((product) =>
  product.id === LAPTOP_ID ? { ...product, stock: product.stock - 1 } : product,
);

/**
 * Linea deficitaria del `409`. Pide `3` —el maximo que la UI deja construir con el
 * catalogo cargado— y el backend responde que solo hay `1`.
 *
 * Ese desfase es el caso que la validacion del cliente **no** puede cubrir y por el que el
 * backend sigue siendo el que manda: el catalogo del navegador es una copia que envejece, y
 * entre la carga y la compra otra sesion pudo llevarse las unidades.
 */
const SHORTAGE: StockShortage = { productId: SABANAS_ID, requested: 3, available: 1 };

/** Linea deficitaria de un producto que el catalogo ya no conoce: la UI cae al id. */
const UNKNOWN_SHORTAGE: StockShortage = {
  productId: 'PROD-999',
  requested: 2,
  available: 0,
};

/** El `409` de la validacion contra el snapshot del catalogo: trae `shortages`. */
const stockRejection = (): ApiClientError =>
  new ApiClientError('Alguna linea del carrito supera el stock disponible.', 'INSUFFICIENT_STOCK', {
    shortages: [SHORTAGE, UNKNOWN_SHORTAGE],
  });

const catalogTable = (): HTMLElement => screen.getByRole('table', { name: 'Catálogo' });

const cartTable = (): HTMLElement => screen.getByRole('table', { name: 'Carrito' });

/**
 * Fila de un producto dentro de una tabla concreta. Se acota con `within` porque el mismo
 * nombre aparece en el catalogo y en el carrito en cuanto la linea existe: una busqueda
 * global encontraria dos coincidencias.
 */
const rowOf = (table: HTMLElement, productName: string): HTMLTableRowElement => {
  const header = within(table).getByRole('rowheader', { name: productName });
  const row = header.closest('tr');
  if (row === null) {
    throw new Error(`La fila de ${productName} no esta dentro de un <tr>.`);
  }
  return row;
};

/** Texto de las celdas de datos de la fila, en orden de columna. */
const cellsOf = (table: HTMLElement, productName: string): readonly string[] =>
  within(rowOf(table, productName))
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '');

/**
 * Indices de las celdas de datos del catalogo, con nombre y no como literales dispersos.
 *
 * El nombre no aparece: es el `rowheader` con el que `cellsOf` localiza la fila, no una
 * celda de datos. Se declara aqui porque varias pruebas indexan estas columnas, y con los
 * literales repartidos anadir la columna del `id` las rompia de una en una sin que ninguna
 * dijera que el problema era el orden.
 */
const CATALOGO = { ID: 0, CATEGORIA: 1, PRECIO: 2, STOCK: 3, ACCION: 4 } as const;

const subtotalText = (): string => screen.getByTestId('cart-subtotal').textContent ?? '';

const clickAdd = (productName: string): void => {
  fireEvent.click(screen.getByRole('button', { name: `Agregar ${productName} al carrito` }));
};

const clickIncrease = (productName: string): void => {
  fireEvent.click(screen.getByRole('button', { name: `Aumentar cantidad de ${productName}` }));
};

const clickDecrease = (productName: string): void => {
  fireEvent.click(screen.getByRole('button', { name: `Disminuir cantidad de ${productName}` }));
};

const clickRemove = (productName: string): void => {
  fireEvent.click(screen.getByRole('button', { name: `Quitar ${productName} del carrito` }));
};

const addButton = (productName: string): HTMLElement =>
  screen.getByRole('button', { name: `Agregar ${productName} al carrito` });

const increaseButton = (productName: string): HTMLElement =>
  screen.getByRole('button', { name: `Aumentar cantidad de ${productName}` });

const decreaseButton = (productName: string): HTMLElement =>
  screen.getByRole('button', { name: `Disminuir cantidad de ${productName}` });

const addTimes = (productName: string, times: number): void => {
  for (let i = 0; i < times; i += 1) {
    clickAdd(productName);
  }
};

/** Campo y accion del cupon: teclear es un `change`, aplicar es un `click` (FK-R2.2). */
const typeCoupon = (code: string): void => {
  fireEvent.change(screen.getByLabelText('Código de cupón'), { target: { value: code } });
};

const clickApply = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
};

const confirmButton = (): HTMLElement => screen.getByRole('button', { name: CONFIRM_LABEL });

const clickConfirm = (): void => {
  fireEvent.click(confirmButton());
};

const breakdownTable = (): HTMLElement =>
  screen.getByRole('table', { name: 'Desglose de descuentos' });

const orderTable = (): HTMLElement => screen.getByRole('table', { name: 'Compra' });

/** Celdas de datos de una linea del desglose: estado, tasa y monto, en orden de columna. */
const breakdownCells = (name: 'CATEGORY' | 'VOLUME' | 'COUPON'): readonly string[] =>
  within(screen.getByTestId(`breakdown-line-${name}`))
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '');

const textOf = (testId: string): string => screen.getByTestId(testId).textContent ?? '';

/**
 * Espera a que el desglose en vuelo aterrice.
 *
 * `add`, `decrement`, `remove` y `applyCoupon` son sincronas y lanzan la peticion como
 * promesa flotante —la pantalla no espera a nadie—, asi que el test no tiene una promesa que
 * encadenar. La espera es del **DOM**, no del estado: el aviso de recalculo desaparece tanto
 * si la peticion resolvio como si fallo, y `waitFor` envuelve la resolucion en `act`, de
 * modo que la actualizacion no ocurre fuera de el.
 *
 * Con el carrito vacio no se pidio nada y el aviso nunca estuvo, asi que el helper resuelve
 * de inmediato y sirve igual a los casos que afirman la ausencia de peticion.
 */
const settledPreview = async (): Promise<void> => {
  await waitFor(() => {
    expect(screen.queryByText(RECALCULATING)).not.toBeInTheDocument();
  });
};

/** Agrega un producto y espera el desglose que ese cambio dispara. */
const addAndSettle = async (productName: string): Promise<void> => {
  clickAdd(productName);
  await settledPreview();
};

/** Aplica un cupon y espera el desglose que la accion dispara. */
const applyAndSettle = async (code: string): Promise<void> => {
  typeCoupon(code);
  clickApply();
  await settledPreview();
};

/**
 * Ultima peticion de desglose recibida por el doble. Lanza en vez de devolver `undefined`
 * para que un fallo de "no se pidio nada" salga como tal.
 */
const lastPreviewRequest = (): CheckoutRequest => {
  const call = requestPreviewDouble.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('No se pidio ningun desglose.');
  }
  return call[0];
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

/**
 * Promesa cuya resolucion decide el test. Es lo que permite afirmar sobre los estados
 * "en vuelo" —el aviso de recalculo y el boton de comprar deshabilitado— sin depender de
 * cuantos microtasks tarda una promesa ya resuelta en aterrizar.
 *
 * El handler se guarda en un objeto con propiedad opcional y se invoca con `?.()` en lugar
 * de declararlo con una assertion de asignacion definida: el ejecutor de `Promise` corre de
 * forma sincrona, asi que ya esta puesto cuando alguien llama.
 */
const deferred = <T,>(): Deferred<T> => {
  const handlers: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>((resolve) => {
    handlers.resolve = resolve;
  });
  return {
    promise,
    resolve: (value: T): void => {
      handlers.resolve?.(value);
    },
  };
};

/**
 * Monta la pantalla y espera a que el catalogo este cargado. La espera es del DOM —que el
 * indicador de carga desaparezca— y no del estado, y ademas cubre el `await` del
 * `useEffect` dentro de `act`, de modo que la resolucion de la promesa no produce un aviso
 * de actualizacion fuera de `act`.
 */
const renderReady = async (): Promise<void> => {
  render(<App />);
  await waitForElementToBeRemoved(() => screen.queryByRole('status'));
};

beforeEach(() => {
  fetchCatalogDouble.mockReset();
  requestPreviewDouble.mockReset();
  requestConfirmationDouble.mockReset();
  // El store es un modulo, no un contexto: vive entre tests y hay que devolverlo a cero.
  // Los campos del cupon, del desglose y de la compra tambien: un `totals` heredado
  // pintaria un desglose que el test que viene no pidio.
  useCartStore.setState({
    catalog: [],
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
  // Invalida las peticiones que un test anterior pudiera haber dejado en vuelo: la rama del
  // carrito vacio avanza el contador de secuencia sin tocar la red, de modo que una
  // respuesta rezagada se descarta en lugar de contaminar el test que viene.
  void useCartStore.getState().refreshPreview();
  fetchCatalogDouble.mockResolvedValue(CATALOG_PRODUCTS);
  requestPreviewDouble.mockResolvedValue(TOTALS);
  requestConfirmationDouble.mockResolvedValue(CONFIRMATION);
});

afterEach(() => {
  // `globals` esta desactivado en vite.config.ts, asi que RTL no registra su limpieza
  // automatica. Sin este `cleanup` los renders convivirian y las consultas encontrarian
  // duplicados de un test anterior.
  cleanup();
});

describe('carga del catalogo (FC-R5.1, FC-R5.6)', () => {
  it('muestra el indicador de carga en el montaje y lo retira al llegar el catalogo', async () => {
    render(<App />);

    // El `set({ status: 'loading' })` del efecto ya corrio dentro del `act` de `render`;
    // la resolucion de la promesa es un microtask posterior.
    expect(screen.getByRole('status')).toHaveTextContent(LOADING);

    await waitForElementToBeRemoved(() => screen.queryByRole('status'));

    expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('invoca el Cliente_Api una sola vez en el montaje', async () => {
    await renderReady();

    expect(fetchCatalogDouble).toHaveBeenCalledTimes(1);
  });

  it('renderiza una fila por producto del catalogo', async () => {
    await renderReady();

    const rows = within(catalogTable()).getAllByRole('row');

    // 6 productos mas la fila de encabezados.
    expect(rows).toHaveLength(CATALOG_PRODUCTS.length + 1);
    expect(within(catalogTable()).getByRole('rowheader', { name: LAPTOP })).toBeInTheDocument();
    expect(within(catalogTable()).getByRole('rowheader', { name: CAMISETA })).toBeInTheDocument();
  });

  it('pinta id, categoria, precio formateado y stock de cada producto', async () => {
    await renderReady();

    // HU 1 enumera los cinco campos: id, nombre, precio unitario, categoria y stock. El
    // nombre es el `rowheader` con el que `cellsOf` localiza la fila; los otros cuatro son
    // las celdas de datos, y la igualdad estricta afirma tambien que no sobra ninguna.
    // Categoria etiquetada CON tilde, precio via formatCents, stock e id tal cual.
    expect(cellsOf(catalogTable(), LAPTOP)).toStrictEqual([
      LAPTOP_ID,
      'Tecnología',
      formatCents(129900), // $1,299.00
      '5',
      'Agregar',
    ]);
    expect(cellsOf(catalogTable(), SABANAS)).toStrictEqual([
      SABANAS_ID,
      'Hogar',
      formatCents(5900), // $59.00
      '3',
      'Agregar',
    ]);
  });

  it('muestra la etiqueta con tilde aunque el literal de la categoria no la tenga', async () => {
    await renderReady();

    const row = rowOf(catalogTable(), AURICULARES);

    // 'Tecnologia' es el literal del contrato; 'Tecnología' es la etiqueta de UI. La
    // pantalla nunca pinta el literal: la tilde vive solo en CATEGORY_LABEL.
    expect(row).toHaveTextContent('Tecnología');
    expect(within(row).queryByText('Tecnologia')).not.toBeInTheDocument();
  });

  it('un fallo del catalogo muestra el mensaje del error tipado', async () => {
    fetchCatalogDouble.mockRejectedValue(
      new ApiClientError('No se pudo contactar con el servidor.'),
    );

    render(<App />);

    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent('No se pudo contactar con el servidor.');
    expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
  });

  it('el fallo no deja filas de catalogo en pantalla', async () => {
    fetchCatalogDouble.mockRejectedValue(new ApiClientError('El catalogo no esta disponible.'));

    render(<App />);
    await screen.findByRole('alert');

    // Solo la fila de encabezados: ningun producto que agregar.
    expect(within(catalogTable()).getAllByRole('row')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: `Agregar ${LAPTOP} al carrito` })).toBeNull();
  });

  it('el fallo conserva el carrito vacio y el subtotal en cero', async () => {
    fetchCatalogDouble.mockRejectedValue(new ApiClientError('Se cayo la red.'));

    render(<App />);
    await screen.findByRole('alert');

    expect(screen.getByText(EMPTY_CART)).toBeInTheDocument();
    expect(subtotalText()).toBe(formatCents(0)); // $0.00
  });
});

describe('carrito vacio (FC-R5.5, FC-R4.3)', () => {
  it('muestra el mensaje explicito en lugar de una tabla sin filas', async () => {
    await renderReady();

    expect(screen.getByText(EMPTY_CART)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Carrito' })).not.toBeInTheDocument();
  });

  it('muestra el subtotal en cero, no una cadena vacia', async () => {
    await renderReady();

    expect(subtotalText()).toBe(formatCents(0)); // $0.00
    expect(subtotalText()).toBe('$0.00');
  });
});

describe('agregar actualiza el subtotal visible (FC-R5.4, FC-R6.5)', () => {
  it('un clic en Agregar reemplaza el mensaje de vacio por la linea', async () => {
    await renderReady();

    clickAdd(LAPTOP);

    expect(screen.queryByText(EMPTY_CART)).not.toBeInTheDocument();
    expect(within(cartTable()).getByRole('rowheader', { name: LAPTOP })).toBeInTheDocument();
  });

  it('un clic en Agregar pinta cantidad 1, el total de la linea y el subtotal', async () => {
    await renderReady();

    clickAdd(LAPTOP);

    // 129900 x 1 = 129900
    expect(cellsOf(cartTable(), LAPTOP)[0]).toBe('1');
    expect(cellsOf(cartTable(), LAPTOP)[1]).toBe(formatCents(129900)); // $1,299.00
    expect(subtotalText()).toBe(formatCents(129900));
  });

  it('dos clics en Agregar suben la cantidad a 2 y duplican el subtotal', async () => {
    await renderReady();

    addTimes(LAPTOP, 2);

    // 129900 x 2 = 259800
    expect(cellsOf(cartTable(), LAPTOP)[0]).toBe('2');
    expect(cellsOf(cartTable(), LAPTOP)[1]).toBe(formatCents(259800)); // $2,598.00
    expect(subtotalText()).toBe(formatCents(259800));
  });

  it('el control + de la linea incrementa igual que Agregar', async () => {
    await renderReady();
    clickAdd(TECLADO);

    clickIncrease(TECLADO);
    clickIncrease(TECLADO);

    // 4550 x 3 = 13650
    expect(cellsOf(cartTable(), TECLADO)[0]).toBe('3');
    expect(subtotalText()).toBe(formatCents(13650)); // $136.50
  });

  it('varias lineas suman en el subtotal visible', async () => {
    await renderReady();

    clickAdd(LAPTOP);
    clickAdd(CAMISETA);

    // 129900 + 1990 = 131890
    expect(subtotalText()).toBe(formatCents(131890)); // $1,318.90
    expect(within(cartTable()).getAllByRole('rowheader')).toHaveLength(2);
  });

  it('el subtotal se actualiza de inmediato, sin volver a llamar al Cliente_Api', async () => {
    await renderReady();

    clickAdd(LAMPARA);
    expect(subtotalText()).toBe(formatCents(3200)); // $32.00

    clickAdd(LAMPARA);
    expect(subtotalText()).toBe(formatCents(6400)); // $64.00

    // El subtotal es optimista y local (D2): esta entrega no consulta al servidor.
    expect(fetchCatalogDouble).toHaveBeenCalledTimes(1);
  });
});

describe('disminuir y quitar (FC-R5.3)', () => {
  it('el control − baja la cantidad y el subtotal visible', async () => {
    await renderReady();
    addTimes(AURICULARES, 3);
    expect(subtotalText()).toBe(formatCents(23970)); // 7990 x 3 = $239.70

    clickDecrease(AURICULARES);

    // 7990 x 2 = 15980
    expect(cellsOf(cartTable(), AURICULARES)[0]).toBe('2');
    expect(subtotalText()).toBe(formatCents(15980)); // $159.80
  });

  it('disminuir desde 1 elimina la fila y devuelve el mensaje de carrito vacio', async () => {
    await renderReady();
    clickAdd(CAMISETA);

    clickDecrease(CAMISETA);

    // Ninguna fila con cantidad 0 en pantalla: la linea desaparece (I1).
    expect(screen.queryByRole('table', { name: 'Carrito' })).not.toBeInTheDocument();
    expect(screen.getByText(EMPTY_CART)).toBeInTheDocument();
    expect(subtotalText()).toBe(formatCents(0)); // $0.00
  });

  it('Quitar elimina la linea entera aunque tenga cantidad 3', async () => {
    await renderReady();
    addTimes(CAMISETA, 3);
    expect(subtotalText()).toBe(formatCents(5970)); // 1990 x 3 = $59.70

    clickRemove(CAMISETA);

    expect(screen.getByText(EMPTY_CART)).toBeInTheDocument();
    expect(subtotalText()).toBe(formatCents(0));
  });

  it('Quitar afecta solo a la linea indicada', async () => {
    await renderReady();
    clickAdd(LAPTOP);
    addTimes(LAMPARA, 2);

    clickRemove(LAPTOP);

    expect(within(cartTable()).queryByRole('rowheader', { name: LAPTOP })).toBeNull();
    expect(cellsOf(cartTable(), LAMPARA)[0]).toBe('2');
    // 3200 x 2 = 6400
    expect(subtotalText()).toBe(formatCents(6400)); // $64.00
  });

  it('quitar del carrito no quita el producto del catalogo', async () => {
    await renderReady();
    clickAdd(LAPTOP);

    clickRemove(LAPTOP);

    expect(within(catalogTable()).getByRole('rowheader', { name: LAPTOP })).toBeInTheDocument();
  });
});

describe('el tope del stock disponible en pantalla', () => {
  it('agregar 6 veces un producto con stock 3 se detiene en 3 y sin error', async () => {
    await renderReady();

    addTimes(SABANAS, 6);

    // Los tres clics que sobran no hacen nada: el boton ya esta deshabilitado.
    expect(cellsOf(catalogTable(), SABANAS)[CATALOGO.STOCK]).toBe('3');
    expect(cellsOf(cartTable(), SABANAS)[0]).toBe('3');
    // 5900 x 3 = 17700
    expect(subtotalText()).toBe(formatCents(17700)); // $177.00
    // Llegar al tope no es un fallo y no se anuncia como tal.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('deshabilita "Agregar" y "+" al alcanzar el stock, y los reactiva al bajar', async () => {
    await renderReady();

    addTimes(SABANAS, 2);

    // Con 2 de 3 todavia queda una unidad: ambos controles siguen vivos.
    expect(addButton(SABANAS)).toBeEnabled();
    expect(increaseButton(SABANAS)).toBeEnabled();

    clickAdd(SABANAS);

    expect(addButton(SABANAS)).toBeDisabled();
    expect(increaseButton(SABANAS)).toBeDisabled();
    // Reducir siempre es valido, tambien en el tope.
    expect(decreaseButton(SABANAS)).toBeEnabled();

    clickDecrease(SABANAS);

    expect(addButton(SABANAS)).toBeEnabled();
    expect(increaseButton(SABANAS)).toBeEnabled();
  });

  it('el catalogo con stock 0 no deja agregar el producto', async () => {
    // Stock agotado por compras previas: el catalogo lo pinta en 0 y el boton no responde.
    fetchCatalogDouble.mockResolvedValue(
      CATALOG_PRODUCTS.map((product) =>
        product.id === SABANAS_ID ? { ...product, stock: 0 } : product,
      ),
    );
    await renderReady();

    expect(cellsOf(catalogTable(), SABANAS)[CATALOGO.STOCK]).toBe('0');
    expect(addButton(SABANAS)).toBeDisabled();

    clickAdd(SABANAS);

    expect(screen.queryByRole('table', { name: 'Carrito' })).not.toBeInTheDocument();
  });
});

describe('la UI pinta el entero del selector sin reformatearlo (I6)', () => {
  it('el subtotal es exactamente lo que formatCents produce, sin centavos sueltos', async () => {
    await renderReady();

    clickAdd(LAPTOP);
    clickAdd(CAMISETA);
    clickIncrease(CAMISETA);

    // 129900 + 1990 x 2 = 133880
    const text = subtotalText();

    expect(text).toBe(formatCents(133880));
    expect(text).toBe('$1,338.80');
    // Ni el entero de centavos crudo, ni un `toFixed` sin separador de miles.
    expect(text).not.toContain('133880');
    expect(text).not.toBe('1338.80');
  });

  it('el total de la linea usa el mismo formateo que el catalogo', async () => {
    await renderReady();
    addTimes(TECLADO, 2);

    // 4550 x 2 = 9100
    expect(cellsOf(catalogTable(), TECLADO)[CATALOGO.PRECIO]).toBe(formatCents(4550)); // $45.50
    expect(cellsOf(cartTable(), TECLADO)[1]).toBe(formatCents(9100)); // $91.00
  });
});
describe('desglose en pantalla (FK-R3.1, FK-R3.2, FK-R3.3, FK-R6.5)', () => {
  it('sin lineas en el carrito muestra el aviso y no pide desglose', async () => {
    await renderReady();

    expect(screen.getByText(NO_BREAKDOWN)).toBeInTheDocument();
    expect(
      screen.queryByRole('table', { name: 'Desglose de descuentos' }),
    ).not.toBeInTheDocument();
    expect(requestPreviewDouble).not.toHaveBeenCalled();
  });

  it('renderiza las tres lineas en orden de precedencia con la etiqueta del backend', async () => {
    await renderReady();

    await addAndSettle(LAPTOP);

    // Tres lineas mas la fila de encabezados: siempre las tres, aplicadas o no (FK-R3.1).
    expect(within(breakdownTable()).getAllByRole('row')).toHaveLength(4);
    expect(
      within(breakdownTable())
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toStrictEqual([DISCOUNT_LABEL.CATEGORY, DISCOUNT_LABEL.VOLUME, DISCOUNT_LABEL.COUPON]);
  });

  it('cada linea pinta si aplico, su tasa y su monto formateado (FK-R3.2)', async () => {
    await renderReady();

    await addAndSettle(LAPTOP);

    // Los montos son los del reparto por mayor resto del fixture canonico: 12990, 5845 y
    // 16660, que suman los 35495 de `rawDiscountCents`.
    expect(breakdownCells('CATEGORY')).toStrictEqual(['Aplicado', '10%', formatCents(12_990)]);
    expect(breakdownCells('VOLUME')).toStrictEqual(['Aplicado', '5%', formatCents(5_845)]);
    expect(breakdownCells('COUPON')).toStrictEqual(['Aplicado', '15%', formatCents(16_660)]);
  });

  it('la linea de cupon no aplicada se muestra igualmente, en cero y sin error', async () => {
    requestPreviewDouble.mockResolvedValue(TOTALS_WITHOUT_COUPON);
    await renderReady();
    await addAndSettle(LAPTOP);

    await applyAndSettle('SUMMER2024');

    // Un cupon expirado no es un error (D4 / FK-R2.6): la senal es la linea no aplicada.
    expect(breakdownCells('COUPON')).toStrictEqual(['No aplicado', '0%', formatCents(0)]);
    expect(breakdownCells('CATEGORY')[0]).toBe('Aplicado');
    expect(breakdownCells('VOLUME')[0]).toBe('Aplicado');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(lastPreviewRequest().couponCode).toBe('SUMMER2024');
  });

  it('el porcentaje efectivo, el ahorro y el total salen tal cual de CheckoutTotals', async () => {
    await renderReady();

    await addAndSettle(LAPTOP);

    // `2732` bps se presentan como `27.32%`: division de un entero en puntos basicos, que
    // no es dinero (FK-R3.4). Los dos montos son enteros del backend pasados por
    // `formatCents`, sin sumar las lineas y sin restar del subtotal (FK-R3.3 / I6).
    expect(textOf('breakdown-effective')).toBe('27.32%');
    expect(textOf('breakdown-savings')).toBe(formatCents(35_495));
    expect(textOf('breakdown-savings')).toBe('$354.95');
    expect(textOf('breakdown-total')).toBe(formatCents(94_405));
    expect(textOf('breakdown-total')).toBe('$944.05');
    // El subtotal optimista del carrito sigue siendo el suyo: no se toca al llegar el
    // desglose, y el total a pagar no se deriva de el.
    expect(subtotalText()).toBe(formatCents(129_900));
  });

  it('marca que el desglose se esta recalculando sin tocar el carrito (FK-R3.5)', async () => {
    const pending = deferred<CheckoutTotals>();
    requestPreviewDouble.mockReturnValue(pending.promise);
    await renderReady();

    clickAdd(LAPTOP);

    expect(screen.getByText(RECALCULATING)).toBeInTheDocument();
    // El carrito y su subtotal siguen en pantalla mientras el desglose viaja.
    expect(cellsOf(cartTable(), LAPTOP)[0]).toBe('1');
    expect(subtotalText()).toBe(formatCents(129_900));

    pending.resolve(TOTALS);
    await settledPreview();

    expect(screen.getByTestId('breakdown-line-CATEGORY')).toBeInTheDocument();
    expect(screen.queryByText(RECALCULATING)).not.toBeInTheDocument();
  });

  it('un fallo del desglose muestra el aviso y conserva el carrito (FK-R3.5)', async () => {
    requestPreviewDouble.mockRejectedValue(new ApiClientError('Se cayo la red.'));
    await renderReady();

    await addAndSettle(LAPTOP);

    expect(screen.getByRole('alert')).toHaveTextContent('Se cayo la red.');
    // El carrito no se toca por un fallo del desglose.
    expect(cellsOf(cartTable(), LAPTOP)[0]).toBe('1');
    expect(subtotalText()).toBe(formatCents(129_900));
    expect(screen.getByText(NO_BREAKDOWN)).toBeInTheDocument();
  });

  it('un fallo posterior conserva el desglose anterior junto al aviso', async () => {
    await renderReady();
    await addAndSettle(LAPTOP);
    expect(textOf('breakdown-total')).toBe(formatCents(94_405));

    requestPreviewDouble.mockRejectedValue(new ApiClientError('Se cayo la red.'));
    await addAndSettle(LAPTOP);

    // Borrar los montos por un fallo de red dejaria la pantalla mas pobre, no mas segura.
    expect(screen.getByRole('alert')).toHaveTextContent('Se cayo la red.');
    expect(textOf('breakdown-total')).toBe(formatCents(94_405));
  });
});

describe('cupon: teclear no pide nada, Aplicar si (FK-R2.2, FK-R6.2)', () => {
  it('teclear en el campo actualiza el valor y no dispara ninguna peticion', async () => {
    await renderReady();
    await addAndSettle(LAPTOP);
    expect(requestPreviewDouble).toHaveBeenCalledTimes(1);

    typeCoupon('WELCOME');
    typeCoupon('WELCOME2026');
    await settledPreview();

    // El borrador es local: ninguna tecla llega a la red (FK-R2.2).
    expect(screen.getByLabelText('Código de cupón')).toHaveValue('WELCOME2026');
    expect(requestPreviewDouble).toHaveBeenCalledTimes(1);
  });

  it('Aplicar envia el codigo tecleado y refresca el desglose', async () => {
    await renderReady();
    await addAndSettle(LAPTOP);

    await applyAndSettle('WELCOME2026');

    expect(requestPreviewDouble).toHaveBeenCalledTimes(2);
    expect(lastPreviewRequest()).toStrictEqual({
      items: [{ productId: LAPTOP_ID, quantity: 1 }],
      couponCode: 'WELCOME2026',
    });
    expect(breakdownCells('COUPON')).toStrictEqual(['Aplicado', '15%', formatCents(16_660)]);
  });
});

describe('Alerta_Tope en sus dos direcciones (FK-R4.1 - FK-R4.4, FK-R6.5, I1, I2)', () => {
  it('aparece con capApplied true, con el texto literal y anunciada como alerta', async () => {
    requestPreviewDouble.mockResolvedValue(TOTALS_CAPPED);
    await renderReady();
    await addAndSettle(LAPTOP);

    await applyAndSettle('DEMOCAP50');

    const alert = screen.getByTestId('cap-alert');

    expect(screen.getByRole('alert')).toBe(alert);
    // Caracter por caracter, con la redaccion de `product-rules.md` escrita a mano en este
    // spec: comparar contra la constante del componente la compararia consigo misma.
    expect(alert.textContent).toBe(
      '¡Enhorabuena! Has alcanzado el límite máximo de ahorro permitido (35%)',
    );
    expect(alert.textContent).toBe(CAP_ALERT_TEXT);
    // El ahorro que se muestra es el ya topado, y las lineas siguen sumando el crudo.
    expect(textOf('breakdown-savings')).toBe(formatCents(45_465));
    expect(breakdownCells('COUPON')).toStrictEqual(['Aplicado', '50%', formatCents(55_532)]);
  });

  it('la fila de ajuste hace que el desglose cuadre con el ahorro reportado', async () => {
    requestPreviewDouble.mockResolvedValue(TOTALS_CAPPED);
    await renderReady();
    await addAndSettle(LAPTOP);

    await applyAndSettle('DEMOCAP50');

    const ajuste = within(screen.getByTestId('breakdown-cap-adjustment'))
      .getAllByRole('cell')
      .map((cell) => cell.textContent ?? '');

    // Tasa del tope, no la de una regla, y el monto con signo: 74368 - 45465 = 28903.
    expect(ajuste).toStrictEqual(['Aplicado', '35%', `−${formatCents(28_903)}`]);
    expect(within(screen.getByTestId('breakdown-cap-adjustment')).getByRole('rowheader'))
      .toHaveTextContent('Ajuste por límite de descuento');

    // La razon de ser de la fila: las tres lineas menos el ajuste dan exactamente el
    // ahorro del pie, asi que lo que el usuario suma en pantalla cuadra (12990 + 5846 +
    // 55532 - 28903 = 45465).
    expect(textOf('breakdown-savings')).toBe(formatCents(45_465));
  });

  it('la fila de ajuste no existe sin truncamiento, ni con el 35% clavado', async () => {
    await renderReady();
    await addAndSettle(LAPTOP);

    // capApplied false con un ahorro alto: no hay nada que ajustar.
    expect(screen.queryByTestId('breakdown-cap-adjustment')).not.toBeInTheDocument();

    requestPreviewDouble.mockResolvedValue(TOTALS_EXACTLY_AT_CAP);
    await applyAndSettle('WELCOME2026');

    // El 35% exacto tampoco fue truncado: misma condicion que la alerta (FK-R4.1).
    expect(screen.queryByTestId('breakdown-cap-adjustment')).not.toBeInTheDocument();
  });

  it('no aparece con capApplied false aunque el ahorro sea alto', async () => {
    await renderReady();

    await addAndSettle(LAPTOP);

    // 35495 centavos de ahorro sobre 129900 es mucho dinero y no es el tope: la condicion
    // no se deriva de la magnitud.
    expect(textOf('breakdown-savings')).toBe(formatCents(35_495));
    expect(screen.queryByTestId('cap-alert')).not.toBeInTheDocument();
    expect(screen.queryByText(CAP_ALERT_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('no aparece con un descuento de exactamente el 35% y sin truncamiento', async () => {
    requestPreviewDouble.mockResolvedValue(TOTALS_EXACTLY_AT_CAP);
    await renderReady();

    await addAndSettle(CAMISETA);

    // Este es el caso que rompe cualquier derivacion por porcentaje o por monto: el
    // efectivo es 3500 bps y el ahorro es exactamente `capCents`, pero no hubo recorte, asi
    // que `capApplied` es `false` y la alerta no se muestra (FK-R4.1, FK-R4.4).
    expect(textOf('breakdown-effective')).toBe('35%');
    expect(textOf('breakdown-savings')).toBe(formatCents(1_393));
    expect(screen.queryByTestId('cap-alert')).not.toBeInTheDocument();
    expect(screen.queryByText(CAP_ALERT_TEXT)).not.toBeInTheDocument();
  });

  it('es persistente: vive mientras la condicion se cumpla y se va con ella', async () => {
    requestPreviewDouble.mockResolvedValueOnce(TOTALS_CAPPED);
    await renderReady();
    await addAndSettle(LAPTOP);
    expect(screen.getByTestId('cap-alert')).toBeInTheDocument();

    // Sin temporizador ni boton de cerrar: sigue ahi tras otro render de la pantalla.
    clickIncrease(LAPTOP);
    expect(screen.getByTestId('cap-alert')).toBeInTheDocument();
    await settledPreview();

    // El desglose nuevo ya no reporta el tope, y la alerta desaparece con la condicion.
    expect(screen.queryByTestId('cap-alert')).not.toBeInTheDocument();
  });
});

describe('confirmar la compra (FK-R5.1, FK-R5.2, FK-R6.6)', () => {
  it('el boton esta deshabilitado con el carrito vacio y se habilita al agregar', async () => {
    await renderReady();

    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText(NO_PURCHASE)).toBeInTheDocument();

    await addAndSettle(LAPTOP);

    expect(confirmButton()).toBeEnabled();
  });

  it('el boton se deshabilita mientras la compra esta en vuelo', async () => {
    const pending = deferred<OrderConfirmation>();
    requestConfirmationDouble.mockReturnValue(pending.promise);
    await renderReady();
    await addAndSettle(CAMISETA);

    clickConfirm();

    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText(SENDING)).toBeInTheDocument();

    pending.resolve(CONFIRMATION_WITHOUT_COUPON);
    await screen.findByTestId('order-id');
    await waitFor(() => {
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    expect(textOf('order-id')).toBe('ORD-0002');
    // `couponCode` es opcional AUSENTE en el contrato: la fila del cupon no existe.
    expect(screen.queryByTestId('order-coupon')).not.toBeInTheDocument();
  });

  it('el exito muestra el comprobante, vacia el carrito y recarga el catalogo', async () => {
    fetchCatalogDouble
      .mockResolvedValueOnce(CATALOG_PRODUCTS)
      .mockResolvedValue(CATALOG_AFTER_PURCHASE);
    await renderReady();
    await addAndSettle(LAPTOP);

    clickConfirm();
    await screen.findByTestId('order-id');
    await waitFor(() => {
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    expect(textOf('order-id')).toBe('ORD-0001');
    // Carrito vacio y desglose retirado: el precio de un carrito que ya no existe no se
    // queda en pantalla.
    expect(screen.getByText(EMPTY_CART)).toBeInTheDocument();
    expect(screen.getByText(NO_BREAKDOWN)).toBeInTheDocument();
    expect(subtotalText()).toBe(formatCents(0));
    expect(confirmButton()).toBeDisabled();
    // La recarga del catalogo es lo que hace visible el stock ya decrementado (FK-R5.3).
    expect(fetchCatalogDouble).toHaveBeenCalledTimes(2);
    expect(cellsOf(catalogTable(), LAPTOP)[CATALOGO.STOCK]).toBe('4');
  });

  it('el comprobante pinta los montos congelados de la orden, sin recalcular', async () => {
    await renderReady();
    await addAndSettle(LAPTOP);

    clickConfirm();
    await screen.findByTestId('order-id');
    await waitFor(() => {
      expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    });

    // Categoria etiquetada con tilde, cantidad cruda y los dos montos de la fila
    // persistida: `lineTotalCents` se formatea, no se multiplica (FK-R5.2 / I6).
    expect(cellsOf(orderTable(), LAPTOP)).toStrictEqual([
      'Tecnología',
      '1',
      formatCents(129_900),
      formatCents(129_900),
    ]);
    expect(textOf('order-coupon')).toBe('WELCOME2026');
    expect(textOf('order-subtotal')).toBe(formatCents(129_900));
    expect(textOf('order-savings')).toBe(formatCents(35_495));
    expect(textOf('order-total')).toBe(formatCents(94_405));
    // La fecha se pinta como la cadena ISO que llega, sin convertirla a un locale.
    expect(screen.getByTestId('order-created-at')).toHaveAttribute(
      'datetime',
      '2026-01-15T10:30:00.000Z',
    );
    expect(textOf('order-created-at')).toBe('2026-01-15T10:30:00.000Z');
  });
});

describe('la compra rechazada conserva el carrito (FK-R5.4, FK-R5.5, FK-R6.6, I5)', () => {
  it('el 409 de stock muestra las lineas deficitarias y el carrito sigue ahi', async () => {
    requestConfirmationDouble.mockRejectedValue(stockRejection());
    await renderReady();
    addTimes(SABANAS, 3);
    await settledPreview();

    clickConfirm();
    await screen.findByTestId('purchase-error');

    expect(
      screen.getByText('Alguna linea del carrito supera el stock disponible.'),
    ).toBeInTheDocument();
    expect(screen.getByText(SHORTAGES_TITLE)).toBeInTheDocument();
    expect(screen.getByTestId(`shortage-${SABANAS_ID}`)).toHaveTextContent(
      'Juego de Sábanas: solicitaste 3, disponible 1',
    );
    // Un producto que el catalogo ya no conoce cae a su identificador, en lugar de
    // ocultarle al usuario que esa linea fue la que sobro.
    expect(screen.getByTestId('shortage-PROD-999')).toHaveTextContent(
      'PROD-999: solicitaste 2, disponible 0',
    );
    // Carrito intacto para corregir y reintentar, sin comprobante y sin recargar catalogo.
    expect(cellsOf(cartTable(), SABANAS)[0]).toBe('3');
    expect(subtotalText()).toBe(formatCents(17_700)); // 5900 x 3 = $177.00
    expect(screen.getByText(NO_PURCHASE)).toBeInTheDocument();
    expect(fetchCatalogDouble).toHaveBeenCalledTimes(1);
  });

  it('cualquier otro fallo muestra el mensaje tipado y ninguna linea deficitaria', async () => {
    requestConfirmationDouble.mockRejectedValue(
      new ApiClientError('El producto no existe.', 'PRODUCT_NOT_FOUND'),
    );
    await renderReady();
    await addAndSettle(LAPTOP);

    clickConfirm();
    await screen.findByTestId('purchase-error');

    expect(screen.getByText('El producto no existe.')).toBeInTheDocument();
    expect(screen.queryByText(SHORTAGES_TITLE)).not.toBeInTheDocument();
    expect(cellsOf(cartTable(), LAPTOP)[0]).toBe('1');
    expect(confirmButton()).toBeEnabled();
  });
});
