import { create } from 'zustand';

import { ApiClientError, fetchCatalog } from '../api/catalog.api';

import type { Product } from '@core/shared';

/**
 * Store_Carrito: catalogo, lineas del carrito y sus acciones (FC-R3).
 *
 * Se declara **fuera de los componentes** (FC-R3.1): el modulo exporta el hook y los
 * selectores, y toda la logica del carrito se prueba invocandolos sin renderizar React.
 *
 * Dos ausencias deliberadas, que son invariantes estructurales del diseno:
 *
 * - **No hay precios en las lineas** (I2 / FC-R3.2). `items` es `Record<string, number>`:
 *   identificador contra cantidad, y nada mas. Si la linea llevara su propio
 *   `priceCents` existirian dos copias del precio —la del catalogo y la del carrito— que
 *   divergen en cuanto el catalogo se recargue tras un checkout. El tipo hace que la
 *   segunda copia no sea representable.
 * - **No hay campo de subtotal** (I4 / FC-R4.2). El subtotal se deriva en cada lectura con
 *   `selectSubtotalCents`. Un campo almacenado seria un segundo lugar que mantener
 *   sincronizado con `items`, y el primer bug seria un subtotal viejo tras un `remove`.
 *
 * El store tampoco invoca `fetch`: delega en `fetchCatalog` del Cliente_Api, que es el
 * unico modulo de la app que conoce rutas y codigos de estado (FC-R2.1).
 */

/** Fase de la carga del catalogo. La pantalla ramifica sobre esto, no sobre `catalog.length`. */
export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Linea del carrito ya resuelta contra el catalogo. Es lo que la pantalla consume: el
 * producto completo mas la cantidad. No se almacena en el estado, se deriva.
 */
export interface CartLine {
  readonly product: Product;
  readonly quantity: number;
}

export interface CartState {
  readonly catalog: readonly Product[];
  /** productId -> quantity. Sin precios: una sola copia del precio, la del catalogo. */
  readonly items: Readonly<Record<string, number>>;
  readonly status: CatalogStatus;
  readonly errorMessage: string | null;

  loadCatalog(): Promise<void>;
  add(productId: string): void;
  decrement(productId: string): void;
  remove(productId: string): void;
}

/** Estado inicial: catalogo vacio y carrito vacio (FC-R3.1). */
const INITIAL_CATALOG: readonly Product[] = [];
const INITIAL_ITEMS: Readonly<Record<string, number>> = {};

/** Solo se alcanza si algo distinto de `ApiClientError` escapa del Cliente_Api. */
const UNEXPECTED = 'Ocurrio un error inesperado al cargar el catalogo.';

/**
 * Devuelve un mapa nuevo sin la clave dada. `Object.fromEntries` sobre un filtro en vez de
 * `delete` sobre una copia: el estado de Zustand se reemplaza, no se muta.
 */
const withoutProduct = (
  items: Readonly<Record<string, number>>,
  productId: string,
): Readonly<Record<string, number>> =>
  Object.fromEntries(Object.entries(items).filter(([id]) => id !== productId));

export const useCartStore = create<CartState>()((set, get) => ({
  catalog: INITIAL_CATALOG,
  items: INITIAL_ITEMS,
  status: 'idle',
  errorMessage: null,

  /**
   * Pide el catalogo al Cliente_Api y traduce su fallo a estado presentable: `status:
   * 'error'` con el mensaje del `ApiClientError`, que ya viene listo para mostrarse
   * (FC-R5.6). El catalogo previo no se borra en el fallo: no hay razon para vaciar la
   * pantalla por una recarga fallida.
   */
  loadCatalog: async (): Promise<void> => {
    set({ status: 'loading', errorMessage: null });
    try {
      const catalog = await fetchCatalog();
      set({ catalog, status: 'ready', errorMessage: null });
    } catch (error: unknown) {
      const message = error instanceof ApiClientError ? error.message : UNEXPECTED;
      set({ status: 'error', errorMessage: message });
    }
  },

  /**
   * Producto ausente -> linea con cantidad `1`; producto presente -> incrementa en `1`
   * (FC-R3.3).
   *
   * **No consulta el stock** (FC-R3.6). Superar el disponible es un estado valido del
   * carrito y su rechazo es responsabilidad del backend; un tope aqui haria imposible
   * demostrar el `409` en vivo.
   */
  add: (productId: string): void => {
    const { items } = get();
    const current = items[productId] ?? 0;
    set({ items: { ...items, [productId]: current + 1 } });
  },

  /**
   * Resta `1` y **elimina la linea al llegar a `0`** (FC-R3.4). Una linea con cantidad
   * cero no es un estado que la UI deba saber pintar, y conservarla obligaria a repartir
   * `if (quantity > 0)` por toda la pantalla.
   *
   * Producto ausente: no hace nada.
   */
  decrement: (productId: string): void => {
    const { items } = get();
    const current = items[productId];
    if (current === undefined) {
      return;
    }
    if (current <= 1) {
      set({ items: withoutProduct(items, productId) });
      return;
    }
    set({ items: { ...items, [productId]: current - 1 } });
  },

  /** Elimina la linea completa, con independencia de su cantidad (FC-R3.5). */
  remove: (productId: string): void => {
    const { items } = get();
    if (items[productId] === undefined) {
      return;
    }
    set({ items: withoutProduct(items, productId) });
  },
}));

/**
 * Une `items` con `catalog` y **descarta los identificadores que el catalogo no conoce**,
 * de modo que un carrito que sobrevive a un cambio de catalogo no rompe el render.
 *
 * Recorre `items` y no `catalog` para conservar el orden en que el cliente fue agregando.
 * El `flatMap` con `[]` es el filtro y el mapeo en un paso: evita un `filter` seguido de un
 * `map` que el compilador ya no podria estrechar sin assertion.
 */
export const selectCartLines = (state: CartState): readonly CartLine[] =>
  Object.entries(state.items).flatMap<CartLine>(([productId, quantity]) => {
    const product = state.catalog.find((candidate) => candidate.id === productId);
    return product === undefined ? [] : [{ product, quantity }];
  });

/**
 * Subtotal optimista: suma de `priceCents x quantity` (FC-R4.1).
 *
 * Producto de enteros, exacto. **Sin redondeo, sin punto flotante y sin `toFixed`**: es la
 * unica aritmetica de dinero que `product-rules.md` autoriza en el frontend. Los descuentos
 * no se calculan aqui; llegan resueltos desde el backend.
 *
 * Derivado en cada lectura, nunca almacenado (FC-R4.2). Carrito vacio -> `0` sin caso
 * especial: el acumulador inicial de `reduce` ya lo cubre (FC-R4.3).
 */
export const selectSubtotalCents = (state: CartState): number =>
  selectCartLines(state).reduce(
    (accumulated, line) => accumulated + line.product.priceCents * line.quantity,
    0,
  );
