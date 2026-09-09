import { fetchCatalog } from '../api/catalog.api';
import { ApiClientError } from '../api/http';

import type { CartSliceCreator } from './state';
import type { Product } from '@core/shared';

/**
 * Slice del carrito: catalogo, lineas y sus acciones (FC-R3).
 *
 * Es el codigo de `frontend-cart` movido sin cambio de comportamiento, con una sola
 * adicion: **`add`, `decrement` y `remove` piden el desglose al terminar** (FK-R2.3). Lo
 * que se muestra tiene que corresponder al carrito actual, y un desglose obsoleto es peor
 * que ninguno.
 *
 * El slice no invoca `fetch`: delega en `fetchCatalog` del Cliente_Api, que es el unico
 * modulo de la app que conoce rutas y codigos de estado (FC-R2.1).
 */

/** Estado inicial: catalogo vacio y carrito vacio (FC-R3.1). */
const INITIAL_CATALOG: readonly Product[] = [];
const INITIAL_ITEMS: Readonly<Record<string, number>> = {};

/** Solo se alcanza si algo distinto de `ApiClientError` escapa del Cliente_Api. */
const UNEXPECTED = 'Ocurrio un error inesperado al cargar el catalogo.';

/**
 * Unidades que todavia caben en el carrito: `stock - cantidad ya agregada`, nunca negativo.
 *
 * Es **la regla del stock escrita una sola vez**, y las tres partes que la necesitan la
 * leen de aqui: `add`, que no deja construir una linea invalida; el boton "Agregar" del
 * catalogo; y el `+` de cada linea del carrito. Escribir `quantity >= stock` en cada uno
 * de los tres seria la misma comparacion en tres sitios, y el primer bug seria uno de
 * ellos quedandose atras.
 *
 * Se recorta en `0` a proposito. Un carrito puede quedar por encima del disponible sin que
 * nadie haga nada mal —basta con que el catalogo se recargue con el stock ya decrementado
 * por otra compra— y en ese caso lo que queda no es un negativo: es que no queda nada.
 */
export const remainingStock = (stock: number, quantityInCart: number): number =>
  Math.max(stock - quantityInCart, 0);

/**
 * Devuelve un mapa nuevo sin la clave dada. `Object.fromEntries` sobre un filtro en vez de
 * `delete` sobre una copia: el estado de Zustand se reemplaza, no se muta.
 */
const withoutProduct = (
  items: Readonly<Record<string, number>>,
  productId: string,
): Readonly<Record<string, number>> =>
  Object.fromEntries(Object.entries(items).filter(([id]) => id !== productId));

export const createCartSlice: CartSliceCreator = (set, get) => ({
  catalog: INITIAL_CATALOG,
  items: INITIAL_ITEMS,
  status: 'idle',
  errorMessage: null,

  /**
   * Pide el catalogo al Cliente_Api y traduce su fallo a estado presentable: `status:
   * 'error'` con el mensaje del `ApiClientError`, que ya viene listo para mostrarse
   * (FC-R5.6). El catalogo previo no se borra en el fallo: no hay razon para vaciar la
   * pantalla por una recarga fallida.
   *
   * **No dispara el desglose.** Recargar el catalogo no cambia ni las lineas ni el cupon,
   * que son las dos entradas del calculo; los precios y el stock los vuelve a leer el
   * backend en cada `preview`.
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
   * (FC-R3.3). Al terminar pide el desglose (FK-R2.3).
   *
   * **Se detiene en el stock disponible.** Sin unidades libres no hay nada que agregar, y
   * entonces no toca `items` y **no pide desglose**, por el mismo criterio con el que
   * `decrement` ignora un producto ausente: una accion que no cambio el carrito no tiene
   * por que producir una peticion.
   *
   * El tope vive aqui y no solo en el `disabled` de los botones. Deshabilitar el control es
   * lo que el usuario ve, pero no es la regla: un segundo componente que llamara a `add`
   * volveria a construir la linea invalida. La vista muestra la regla; el store la aplica.
   *
   * Esto **no reemplaza la validacion del backend**, que sigue siendo la que manda: el
   * catalogo del cliente es una copia que envejece, y entre la carga y la compra el stock
   * puede haber cambiado. Aqui se evita construir un carrito que ya se sabe invalido; alla
   * se rechaza el que llegue igualmente.
   */
  add: (productId: string): void => {
    const { items, catalog } = get();
    const product = catalog.find((candidate) => candidate.id === productId);
    const current = items[productId] ?? 0;

    // Producto que el catalogo no conoce: sin stock que consultar, no se agrega.
    if (product === undefined || remainingStock(product.stock, current) === 0) {
      return;
    }

    set({ items: { ...items, [productId]: current + 1 } });
    void get().refreshPreview();
  },

  /**
   * Resta `1` y **elimina la linea al llegar a `0`** (FC-R3.4). Una linea con cantidad
   * cero no es un estado que la UI deba saber pintar, y conservarla obligaria a repartir
   * `if (quantity > 0)` por toda la pantalla.
   *
   * Producto ausente: no hace nada, y en particular **no pide desglose**. Una accion que
   * no cambio el carrito no tiene por que producir una peticion.
   */
  decrement: (productId: string): void => {
    const { items } = get();
    const current = items[productId];
    if (current === undefined) {
      return;
    }
    if (current <= 1) {
      set({ items: withoutProduct(items, productId) });
    } else {
      set({ items: { ...items, [productId]: current - 1 } });
    }
    void get().refreshPreview();
  },

  /**
   * Elimina la linea completa, con independencia de su cantidad (FC-R3.5), y pide el
   * desglose. Si la linea era la ultima, `refreshPreview` toma la rama del carrito vacio y
   * devuelve `totals` a `null` en lugar de dejar el desglose anterior en pantalla
   * (FK-R2.4).
   */
  remove: (productId: string): void => {
    const { items } = get();
    if (items[productId] === undefined) {
      return;
    }
    set({ items: withoutProduct(items, productId) });
    void get().refreshPreview();
  },
});
