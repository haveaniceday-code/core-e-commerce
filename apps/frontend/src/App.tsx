import { useEffect } from 'react';

import { CapAlert } from './components/CapAlert';
import { CartPanel } from './components/CartPanel';
import { CatalogTable } from './components/CatalogTable';
import { CouponInput } from './components/CouponInput';
import { DiscountBreakdown } from './components/DiscountBreakdown';
import { OrderConfirmationPanel } from './components/OrderConfirmationPanel';
import { useCartStore } from './store/cart.store';

/**
 * Pantalla_Carrito: catalogo, carrito y subtotal en una sola vista, sin router (D4).
 *
 * `App` **compone y no decide nada** (FK-R3.5). El criterio de particion quedo escrito en
 * `frontend-cart` —"si la entrega del cupon la hace crecer, se parte entonces"—, y la
 * pantalla pasa de dos bloques a seis, asi que cada bloque vive en su propio componente:
 * `CatalogTable` y `CartPanel` salen de aqui sin cambio de comportamiento, y los cuatro de
 * la entrega del cupon se suman al mismo nivel.
 *
 * Lo que queda en este archivo es la composicion y el disparo de la carga inicial. Ese
 * `useEffect` no es una decision de negocio: es el arranque de la pantalla, y sigue
 * delegando en el store, que a su vez delega en el Cliente_Api. Ningun componente de esta
 * app invoca `fetch` (I7 / FC-R2.1).
 *
 * `App` tampoco se suscribe al store: los componentes leen del store por su cuenta, cada
 * uno con la granularidad que su contenido necesita. Un padre suscrito al estado completo
 * volveria a renderizar los seis bloques por cualquier cambio, que es exactamente lo que
 * partir la pantalla evita.
 */
export const App = (): JSX.Element => {
  // Unica llamada a la API de esta entrega, disparada en el montaje.
  useEffect(() => {
    void useCartStore.getState().loadCatalog();
  }, []);

  return (
    <main className="app">
      <h1 className="app__titulo">Core E-Commerce</h1>

      {/*
        Los dos `div` son de presentacion y solo de presentacion: la hoja de estilos los
        usa para poner en columnas lo que sigue siendo una sola secuencia, y por debajo de
        960px la rejilla colapsa y esa secuencia se lee tal cual.

        El corte va **entre el carrito y el cupon**, y no despues del catalogo. Es la unica
        particion que hace las dos cosas a la vez: deja a la izquierda lo que se arma —el
        catalogo y el carrito que se llena desde el— y a la derecha lo que se cobra —cupon,
        desglose y confirmacion—, y de paso reparte el alto. Con el catalogo solo, la
        columna izquierda quedaba vacia de la mitad para abajo y las cuatro tarjetas
        restantes empujaban el boton de comprar al final de la pagina.

        Sigue siendo un corte contiguo de la secuencia original, asi que el orden del DOM
        no cambia: la lectura secuencial y las pruebas ven exactamente lo mismo.
      */}
      <div className="app__rejilla">
        <div className="app__columna">
          <CatalogTable />
          <CartPanel />
        </div>

        <div className="app__columna">
          <CouponInput />
          <DiscountBreakdown />
          {/* Se autocensura cuando `capApplied` no es `true`: devuelve `null` y no ocupa sitio. */}
          <CapAlert />
          <OrderConfirmationPanel />
        </div>
      </div>
    </main>
  );
};
