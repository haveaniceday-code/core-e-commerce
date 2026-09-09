import { useEffect, useMemo } from 'react';

import { CATEGORY_LABEL, formatCents } from '@core/shared';

import { selectCartLines, selectSubtotalCents, useCartStore } from './store/cart.store';

import type { CartLine } from './store/cart.store';

/**
 * Pantalla_Carrito: catalogo, carrito y subtotal en una sola vista, sin router (D4).
 *
 * El componente es tonto por diseno (FC-R5): lee del Store_Carrito, despacha sus acciones
 * y formatea con `formatCents` de `@core/shared`. Lo que **no** hace es igual de
 * importante:
 *
 * - **No invoca `fetch`** (I7 / FC-R2.1). El montaje dispara `loadCatalog`, que delega en
 *   el Cliente_Api. El componente no conoce rutas ni codigos de estado.
 * - **No calcula descuentos ni redondea** (FC-R4.4). No hay `toFixed` en este archivo, ni
 *   division, ni punto flotante: el formateo es propiedad de `@core/shared` y el desglose
 *   llega resuelto desde el backend en la entrega siguiente.
 * - **No re-deriva estado**. El subtotal y las lineas salen de los selectores del store,
 *   no de copias locales.
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

export const App = (): JSX.Element => {
  const state = useCartStore();
  const { catalog, status, errorMessage } = state;

  const lines = useMemo(() => selectCartLines(state), [state]);
  const subtotalCents = useMemo(() => selectSubtotalCents(state), [state]);

  // Unica llamada a la API de esta entrega, disparada en el montaje.
  useEffect(() => {
    void useCartStore.getState().loadCatalog();
  }, []);

  return (
    <main>
      <h1>Core E-Commerce</h1>

      <section aria-labelledby="catalogo-titulo">
        <h2 id="catalogo-titulo">Catálogo</h2>

        {status === 'loading' && <p role="status">Cargando catálogo…</p>}
        {status === 'error' && <p role="alert">{errorMessage}</p>}

        <table aria-labelledby="catalogo-titulo">
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col">Categoría</th>
              <th scope="col">Precio</th>
              <th scope="col">Stock</th>
              <th scope="col">Acción</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((product) => (
              <tr key={product.id}>
                <th scope="row">{product.name}</th>
                {/* La tilde vive solo en la etiqueta, nunca en el literal (FC-R5.1). */}
                <td>{CATEGORY_LABEL[product.category]}</td>
                <td>{formatCents(product.priceCents)}</td>
                <td>{product.stock}</td>
                <td>
                  {/*
                    El boton no se deshabilita por stock (D1 / FC-R3.6): superar el
                    disponible es un estado valido del carrito y su rechazo es del backend.
                  */}
                  <button
                    type="button"
                    aria-label={`Agregar ${product.name} al carrito`}
                    onClick={() => {
                      addToCart(product.id);
                    }}
                  >
                    Agregar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

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
                <th scope="col">Cantidad</th>
                <th scope="col">Total</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.product.id}>
                  <th scope="row">{line.product.name}</th>
                  <td>{line.quantity}</td>
                  <td>{formatCents(lineTotalCents(line))}</td>
                  <td>
                    {/*
                      Los glifos `+`, `−` y `x` no son nombres accesibles utiles, asi que
                      cada control declara el suyo con `aria-label` incluyendo el producto:
                      con varias lineas en pantalla, "Aumentar" a secas seria ambiguo.
                    */}
                    <button
                      type="button"
                      aria-label={`Aumentar cantidad de ${line.product.name}`}
                      onClick={() => {
                        addToCart(line.product.id);
                      }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      aria-label={`Disminuir cantidad de ${line.product.name}`}
                      onClick={() => {
                        decrementLine(line.product.id);
                      }}
                    >
                      −
                    </button>
                    <button
                      type="button"
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
        <p>
          Subtotal: <strong data-testid="cart-subtotal">{formatCents(subtotalCents)}</strong>
        </p>
      </section>
    </main>
  );
};
