import { CATEGORY_LABEL, formatCents } from '@core/shared';

import { useCartStore } from '../store/cart.store';

/**
 * Catalogo: una fila por producto, con su boton de agregar (FC-R5.1, FC-R5.6).
 *
 * Extraido de `App.tsx` sin cambio de comportamiento. Es tonto por diseno: lee del
 * Store_Carrito y despacha `add`. **No invoca `fetch`** —la carga la dispara la
 * composicion— y **no calcula ni redondea montos**: `formatCents` de `@core/shared` es el
 * unico que produce el texto del precio.
 *
 * Se suscribe campo por campo y no al estado completo porque los tres son referencias
 * estables: `catalog` solo cambia de identidad cuando el store hace `set`, y `status` y
 * `errorMessage` son primitivos. El motivo por el que `CartPanel` si necesita el estado
 * completo —`selectCartLines` construye un arreglo nuevo en cada invocacion— no aplica
 * aqui.
 */

/** Se invoca unida a su store, nunca desligada (`@typescript-eslint/unbound-method`). */
const addToCart = (productId: string): void => {
  useCartStore.getState().add(productId);
};

export const CatalogTable = (): JSX.Element => {
  const catalog = useCartStore((state) => state.catalog);
  const status = useCartStore((state) => state.status);
  const errorMessage = useCartStore((state) => state.errorMessage);

  return (
    <section aria-labelledby="catalogo-titulo">
      <h2 id="catalogo-titulo">Catálogo</h2>

      {status === 'loading' && <p role="status">Cargando catálogo…</p>}
      {status === 'error' && <p role="alert">{errorMessage}</p>}

      <table aria-labelledby="catalogo-titulo">
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col">Categoría</th>
            <th scope="col" className="num">Precio</th>
            <th scope="col" className="num">Stock</th>
            <th scope="col" className="num">Acción</th>
          </tr>
        </thead>
        <tbody>
          {catalog.map((product) => (
            <tr key={product.id}>
              <th scope="row">{product.name}</th>
              {/* La tilde vive solo en la etiqueta, nunca en el literal (FC-R5.1). */}
              <td>{CATEGORY_LABEL[product.category]}</td>
              <td className="num">{formatCents(product.priceCents)}</td>
              <td className="num">{product.stock}</td>
              <td className="acciones">
                {/*
                  El boton no se deshabilita por stock (D1 / FC-R3.6): superar el
                  disponible es un estado valido del carrito y su rechazo es del backend.
                */}
                <button
                  type="button"
                  className="boton--primario"
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
  );
};
