import { useMemo } from 'react';

import { formatCents } from '@core/shared';

import {
  remainingStock,
  selectCartLines,
  selectSubtotalCents,
  useCartStore,
} from '../store/cart.store';

import type { CartLine } from '../store/cart.store';

/**
 * Carrito: lineas, controles de cantidad y subtotal optimista (FC-R5.3, FC-R5.5, FC-R4.3).
 *
 * Extraido de `App.tsx` sin cambio de comportamiento. Lee del Store_Carrito, despacha
 * `add`, `decrement` y `remove`, y formatea con `formatCents`. No invoca `fetch` y no
 * re-deriva estado: las lineas y el subtotal salen de los selectores, no de copias locales.
 *
 * ## Suscripcion al store
 *
 * Se suscribe al estado completo con `useCartStore()` en vez de a cada campo por separado.
 * El motivo es concreto: `selectCartLines` construye un arreglo nuevo en cada invocacion, y
 * pasarlo como selector a Zustand 5 haria que `getSnapshot` devolviera una referencia
 * distinta en cada lectura —el aviso de React y, en el peor caso, un bucle de renders—.
 * El objeto de estado, en cambio, solo cambia de identidad cuando el store hace `set`, asi
 * que es una dependencia estable para `useMemo` y las lineas se derivan una vez por cambio
 * real del carrito.
 *
 * Las **acciones** no se leen del estado suscrito sino que se invocan sobre
 * `useCartStore.getState()` en el momento del evento. Dos razones: nunca cambian de
 * identidad, asi que suscribirse a ellas no aporta nada; y extraerlas por destructuring las
 * separaria de su objeto, que es precisamente lo que `@typescript-eslint/unbound-method`
 * marca. Invocarlas siempre unidas a su store deja el `this` fuera de discusion.
 */

/** Handlers de las acciones del store. Se invocan unidas a su objeto, nunca desligadas. */
const addToCart = (productId: string): void => {
  useCartStore.getState().add(productId);
};

const decrementLine = (productId: string): void => {
  useCartStore.getState().decrement(productId);
};

const removeLine = (productId: string): void => {
  useCartStore.getState().remove(productId);
};

/**
 * Total de una linea: `priceCents x quantity`. Producto de enteros, exacto.
 *
 * Es la unica aritmetica de dinero que `product-rules.md` autoriza en el frontend, la misma
 * que usa `selectSubtotalCents`: sin division, sin redondeo y sin punto flotante. Vive fuera
 * del componente y con nombre propio para que quede claro que no es un calculo de negocio
 * disfrazado.
 */
const lineTotalCents = (line: CartLine): number => line.product.priceCents * line.quantity;

export const CartPanel = (): JSX.Element => {
  const state = useCartStore();

  const lines = useMemo(() => selectCartLines(state), [state]);
  const subtotalCents = useMemo(() => selectSubtotalCents(state), [state]);

  return (
    <section aria-labelledby="carrito-titulo">
      <h2 id="carrito-titulo">Carrito</h2>

      {lines.length === 0 ? (
        // Mensaje explicito, no una tabla sin filas (FC-R5.5).
        <p>El carrito está vacío. Agrega productos del catálogo para empezar.</p>
      ) : (
        <table aria-labelledby="carrito-titulo">
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col" className="num">Cantidad</th>
              <th scope="col" className="num">Total</th>
              <th scope="col" className="num">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.product.id}>
                <th scope="row">{line.product.name}</th>
                <td className="num">{line.quantity}</td>
                <td className="num">{formatCents(lineTotalCents(line))}</td>
                <td className="acciones">
                  {/*
                    Los glifos `+`, `−` y `x` no son nombres accesibles utiles, asi que
                    cada control declara el suyo con `aria-label` incluyendo el producto:
                    con varias lineas en pantalla, "Aumentar" a secas seria ambiguo.
                  */}
                  {/*
                    El `+` se apaga al llegar al stock disponible, con la misma regla que
                    el boton "Agregar" del catalogo y que `add`. El `−` y el "Quitar" nunca
                    se deshabilitan: reducir el carrito siempre es valido.
                  */}
                  <button
                    type="button"
                    className="boton--icono"
                    disabled={remainingStock(line.product.stock, line.quantity) === 0}
                    aria-label={`Aumentar cantidad de ${line.product.name}`}
                    onClick={() => {
                      addToCart(line.product.id);
                    }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="boton--icono"
                    aria-label={`Disminuir cantidad de ${line.product.name}`}
                    onClick={() => {
                      decrementLine(line.product.id);
                    }}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="boton--sutil"
                    aria-label={`Quitar ${line.product.name} del carrito`}
                    onClick={() => {
                      removeLine(line.product.id);
                    }}
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/*
        Al pie y siempre visible, tambien con el carrito vacio: el selector devuelve `0`
        sin caso especial (FC-R4.3) y el monto se pinta con el mismo `formatCents`. El
        entero viaja del selector al DOM sin reformatearse por el camino (I6).
      */}
      <p className="total">
        <span>Subtotal</span>
        <strong data-testid="cart-subtotal">{formatCents(subtotalCents)}</strong>
      </p>
    </section>
  );
};
