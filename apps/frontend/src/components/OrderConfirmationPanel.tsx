import { CATEGORY_LABEL, formatCents } from '@core/shared';

import { useCartStore } from '../store/cart.store';

import type { OrderConfirmation, StockShortage } from '@core/shared';

/**
 * Panel_Confirmacion: la accion de comprar y el comprobante de la orden
 * (FK-R5.1, FK-R5.2, FK-R5.4, FK-R5.5).
 *
 * **Muestra, no decide.** Cada monto del comprobante es un entero que viaja dentro de
 * `OrderConfirmation` pasado por `formatCents`: no se multiplica la cantidad por el precio
 * unitario para obtener el total de linea —`lineTotalCents` ya viene congelado en la orden
 * persistida—, no se suman las lineas para obtener el subtotal y no se resta el ahorro para
 * obtener el total a pagar (FK-R5.2 / I6). Recomponer aqui cualquiera de esos valores seria
 * un segundo calculo capaz de divergir de la orden que quedo en la base de datos, que es
 * justo lo que el comprobante existe para acreditar.
 *
 * Los tres estados del panel son los que el diseno dejo escritos: la orden confirmada, el
 * rechazo por stock con sus lineas deficitarias, y cualquier otro fallo con el mensaje del
 * error tipado. **En los dos casos de fallo el carrito queda intacto** (FK-R5.4, FK-R5.5),
 * y eso no es una decision de este componente: el store conserva `items` al fallar, y aqui
 * simplemente no hay nada que lo vacie.
 *
 * Se suscribe campo por campo, como `CatalogTable`: `items`, `confirmation`, `shortages` y
 * `catalog` solo cambian de identidad cuando el store hace `set`, y `purchaseStatus` y
 * `purchaseError` son primitivos.
 */

/** Textos de pantalla, fijados aqui porque son contrato de UI y no detalle interno. */
const CONFIRM_LABEL = 'Confirmar la compra';
const SENDING = 'Confirmando la compra…';
const NO_PURCHASE = 'Confirma la compra para ver el comprobante de tu orden.';
const SHORTAGES_TITLE = 'Líneas que superan el stock disponible:';

/** Se invoca unida a su store, nunca desligada (`@typescript-eslint/unbound-method`). */
const confirmPurchase = (): void => {
  void useCartStore.getState().confirmPurchase();
};

/**
 * Lineas deficitarias del `409` de stock (FK-R5.4): producto, cantidad solicitada y
 * cantidad disponible, tal como llegan en los detalles del error.
 *
 * El nombre se resuelve contra el catalogo ya cargado y cae al identificador cuando no
 * aparece: `StockShortage` transporta `productId` porque es lo que el backend sabe sin
 * releer nada, y un producto retirado del catalogo no debe impedir que el usuario vea que
 * esa linea fue la que sobro.
 *
 * Las cantidades se pintan crudas y no con `formatCents`: son unidades, no dinero.
 */
const ShortageList = ({
  shortages,
  nameOf,
}: {
  readonly shortages: readonly StockShortage[];
  readonly nameOf: (productId: string) => string;
}): JSX.Element => (
  <>
    <p id="faltantes-titulo">{SHORTAGES_TITLE}</p>
    <ul aria-labelledby="faltantes-titulo">
      {shortages.map((shortage) => (
        <li key={shortage.productId} data-testid={`shortage-${shortage.productId}`}>
          {nameOf(shortage.productId)}: solicitaste {shortage.requested}, disponible{' '}
          {shortage.available}
        </li>
      ))}
    </ul>
  </>
);

/**
 * Comprobante de la orden persistida (FK-R5.2).
 *
 * `createdAt` se pinta como la cadena ISO-8601 que llega, dentro de un `<time dateTime>`
 * para que sea legible por maquina. No se convierte a `Date` ni se formatea con un locale:
 * el resultado dependeria de la zona horaria del navegador y produciria dos textos
 * distintos para el mismo instante, incluido el de la prueba frente al de la demo.
 *
 * `couponCode` es opcional **ausente** en el contrato, asi que la fila del cupon solo
 * existe cuando la orden se cerro con uno.
 */
const Receipt = ({ confirmation }: { readonly confirmation: OrderConfirmation }): JSX.Element => (
  <>
    <p className="dato">
      <span>Orden</span> <strong data-testid="order-id">{confirmation.orderId}</strong>
    </p>
    <p className="dato">
      <span>Fecha</span>{' '}
      <time dateTime={confirmation.createdAt} data-testid="order-created-at">
        {confirmation.createdAt}
      </time>
    </p>
    {confirmation.couponCode !== undefined && (
      <p className="dato">
        <span>Cupón</span> <strong data-testid="order-coupon">{confirmation.couponCode}</strong>
      </p>
    )}

    <table aria-labelledby="compra-titulo">
      <thead>
        <tr>
          <th scope="col">Producto</th>
          <th scope="col">Categoría</th>
          <th scope="col" className="num">Cantidad</th>
          <th scope="col" className="num">Precio unitario</th>
          <th scope="col" className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {confirmation.items.map((item) => (
          <tr key={item.productId} data-testid={`order-item-${item.productId}`}>
            <th scope="row">{item.name}</th>
            {/* La tilde vive solo en la etiqueta, nunca en el literal. */}
            <td>{CATEGORY_LABEL[item.category]}</td>
            <td className="num">{item.quantity}</td>
            {/* Montos congelados en la orden: se formatean, no se multiplican. */}
            <td className="num">{formatCents(item.unitPriceCents)}</td>
            <td className="num">{formatCents(item.lineTotalCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>

    {/*
      Totales de `OrderConfirmation.totals`, el mismo `CheckoutTotals` embebido que el
      backend calculo y persistio. Tres enteros que se formatean y nada mas: sin sumar,
      sin restar y sin volver a redondear (FK-R5.2).
    */}
    <p className="total">
      <span>Subtotal</span>
      <strong data-testid="order-subtotal">
        {formatCents(confirmation.totals.originalSubtotalCents)}
      </strong>
    </p>
    <p className="total">
      <span>Ahorro total</span>
      <strong data-testid="order-savings">
        {formatCents(confirmation.totals.totalSavingsCents)}
      </strong>
    </p>
    <p className="total total--destacado">
      <span>Total pagado</span>
      <strong data-testid="order-total">
        {formatCents(confirmation.totals.finalTotalCents)}
      </strong>
    </p>
  </>
);

export const OrderConfirmationPanel = (): JSX.Element => {
  const items = useCartStore((state) => state.items);
  const catalog = useCartStore((state) => state.catalog);
  const confirmation = useCartStore((state) => state.confirmation);
  const purchaseStatus = useCartStore((state) => state.purchaseStatus);
  const purchaseError = useCartStore((state) => state.purchaseError);
  const shortages = useCartStore((state) => state.shortages);

  /**
   * Deshabilitado con el carrito vacio o con una peticion en curso (FK-R5.1). El carrito
   * vacio se decide contando las claves de `items`, no leyendo el subtotal: una compra sin
   * lineas no tiene sentido con independencia de cuanto sume.
   */
  const isSending = purchaseStatus === 'sending';
  const isEmpty = Object.keys(items).length === 0;

  const nameOf = (productId: string): string =>
    catalog.find((candidate) => candidate.id === productId)?.name ?? productId;

  return (
    <section aria-labelledby="compra-titulo">
      <h2 id="compra-titulo">Compra</h2>

      <button
        type="button"
        className="boton--primario"
        disabled={isEmpty || isSending}
        onClick={() => {
          confirmPurchase();
        }}
      >
        {CONFIRM_LABEL}
      </button>

      {isSending && <p role="status">{SENDING}</p>}

      {/*
        Los dos casos de fallo comparten el mensaje del error tipado y se diferencian por
        los detalles: el `409` de stock trae las lineas deficitarias y cualquier otra causa
        no las trae. Ni uno ni otro toca el carrito (FK-R5.4, FK-R5.5).
      */}
      {purchaseStatus === 'error' && (
        <div className="aviso-error" data-testid="purchase-error">
          <p role="alert">{purchaseError}</p>
          {shortages.length > 0 && <ShortageList shortages={shortages} nameOf={nameOf} />}
        </div>
      )}

      {confirmation === null ? <p>{NO_PURCHASE}</p> : <Receipt confirmation={confirmation} />}
    </section>
  );
};
