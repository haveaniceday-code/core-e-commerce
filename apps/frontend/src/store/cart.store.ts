import { create } from 'zustand';

import { createCartSlice } from './cart.slice';
import { createCheckoutSlice } from './checkout.slice';

import type { CartLine, CartState } from './state';

/**
 * Store_Compra: catalogo, lineas del carrito, cupon, desglose y confirmacion de la orden
 * (FC-R3, FK-R2.1).
 *
 * Se declara **fuera de los componentes** (FC-R3.1): el modulo exporta el hook y los
 * selectores, y toda la logica se prueba invocandolos sin renderizar React.
 *
 * ## Un store, dos slices
 *
 * El carrito y el checkout comparten un unico `create` (D1). Dos stores para una sola
 * pantalla obligarian a sincronizar dos fuentes, y el desglose depende directamente de las
 * lineas: `add` tiene que poder pedirlo sin puentes entre stores.
 *
 * La particion en slices es la que el diseno dejo condicionada al tamano del archivo: se
 * mantenia en uno mientras no pasara de ~250 lineas, y sumarle el cupon, el desglose y la
 * compra lo pasa. Desde fuera de este directorio la particion es invisible: los
 * componentes leen `CartState` y no saben de que slice viene cada campo.
 *
 * ## Lo que este store no hace
 *
 * No invoca `fetch` —delega en el Cliente_Api, unico modulo que conoce rutas y verbos
 * (FC-R2.1)— y no calcula dinero mas alla del subtotal optimista de `selectSubtotalCents`
 * (FK-R2.7). Los descuentos, el redondeo y la decision del tope son del backend, y llegan
 * resueltos dentro de `totals`.
 */
export const useCartStore = create<CartState>()((...args) => ({
  ...createCartSlice(...args),
  ...createCheckoutSlice(...args),
}));

/**
 * La regla del stock se re-exporta desde aqui porque este modulo es la cara publica del
 * store: los componentes importan `useCartStore` y sus selectores de un solo sitio y no
 * necesitan saber en que slice vive cada cosa.
 */
export { remainingStock } from './cart.slice';

export type {
  CartLine,
  CartSlice,
  CartState,
  CatalogStatus,
  CheckoutSlice,
  PreviewStatus,
  PurchaseStatus,
} from './state';

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
 * no se calculan aqui; llegan resueltos desde el backend dentro de `totals`.
 *
 * Derivado en cada lectura, nunca almacenado (FC-R4.2). Carrito vacio -> `0` sin caso
 * especial: el acumulador inicial de `reduce` ya lo cubre (FC-R4.3).
 */
export const selectSubtotalCents = (state: CartState): number =>
  selectCartLines(state).reduce(
    (accumulated, line) => accumulated + line.product.priceCents * line.quantity,
    0,
  );
