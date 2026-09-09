import { CATALOG_PRODUCTS, formatCents } from '@core/shared';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { ApiClientError, fetchCatalog } from './api/catalog.api';
import { useCartStore } from './store/cart.store';

/**
 * Suite de la Pantalla_Carrito (FC-R6.5).
 *
 * Dos decisiones gobiernan todo el archivo:
 *
 * 1. **El doble es del Cliente_Api, no de `fetch`.** `catalog.api.spec.ts` ya cubre la
 *    frontera de red; lo que aqui interesa es la pantalla, asi que se sustituye la unica
 *    dependencia externa que el store tiene. El mock es **parcial** y conserva la clase
 *    real `ApiClientError`: el `instanceof` de `loadCatalog` compara contra la misma clase
 *    que este spec lanza. Un mock total daria dos clases homonimas y el `instanceof`
 *    fallaria en silencio, confundiendo el mensaje del error con el mensaje generico de
 *    fallo inesperado. `vi.fn<typeof ...>` y `vi.mocked` mantienen el doble tipado: cero
 *    `any` y cero assertions (MF-R2.4).
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

const fetchCatalogDouble = vi.mocked(fetchCatalog);

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

const addTimes = (productName: string, times: number): void => {
  for (let i = 0; i < times; i += 1) {
    clickAdd(productName);
  }
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
  fetchCatalogDouble.mockResolvedValue(CATALOG_PRODUCTS);
  // El store es un modulo, no un contexto: vive entre tests y hay que devolverlo a cero.
  useCartStore.setState({ catalog: [], items: {}, status: 'idle', errorMessage: null });
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

  it('pinta categoria, precio formateado y stock de cada producto', async () => {
    await renderReady();

    // Categoria etiquetada CON tilde, precio via formatCents, stock tal cual.
    expect(cellsOf(catalogTable(), LAPTOP)).toStrictEqual([
      'Tecnología',
      formatCents(129900), // $1,299.00
      '5',
      'Agregar',
    ]);
    expect(cellsOf(catalogTable(), SABANAS)).toStrictEqual([
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

describe('superar el stock disponible (FC-R3.6, D1)', () => {
  it('agregar 6 veces un producto con stock 3 se refleja en pantalla sin error', async () => {
    await renderReady();

    addTimes(SABANAS, 6);

    // El boton no se deshabilita y no aparece alerta: el rechazo es del backend.
    expect(cellsOf(catalogTable(), SABANAS)[2]).toBe('3');
    expect(cellsOf(cartTable(), SABANAS)[0]).toBe('6');
    // 5900 x 6 = 35400
    expect(subtotalText()).toBe(formatCents(35400)); // $354.00
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    expect(cellsOf(catalogTable(), TECLADO)[1]).toBe(formatCents(4550)); // $45.50
    expect(cellsOf(cartTable(), TECLADO)[1]).toBe(formatCents(9100)); // $91.00
  });
});
