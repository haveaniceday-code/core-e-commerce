import { formatCents } from '@core/shared';

import { useCartStore } from '../store/cart.store';

import type { CheckoutTotals } from '@core/shared';

/**
 * Panel_Desglose: las tres lineas de descuento y los totales del backend
 * (FK-R3.1 - FK-R3.5).
 *
 * **Muestra, no decide.** Cada monto que aparece aqui es un entero de `CheckoutTotals`
 * pasado por `formatCents`, sin una sola operacion aritmetica de dinero por el camino: nada
 * de sumar las lineas para obtener el ahorro, nada de restar para obtener el total y nada
 * de `toFixed` (I6 / FK-R2.7). El ahorro y el total a pagar viajan ya calculados en la
 * respuesta, y recomponerlos aqui seria un segundo calculo que puede divergir del que el
 * backend persiste.
 *
 * Las etiquetas tampoco se componen: la `label` de cada linea llega lista del backend, que
 * la toma de `DISCOUNT_LABEL` (FK-R3.1). La UI no concatena "Descuento" con una categoria
 * ni con un porcentaje; si lo hiciera, existirian dos redacciones del mismo texto.
 *
 * Se suscribe campo por campo, como `CatalogTable`: `totals` solo cambia de identidad
 * cuando el store hace `set`, y `previewStatus` y `previewError` son primitivos.
 */

/** Textos de pantalla, fijados aqui porque son contrato de UI y no detalle interno. */
const NO_BREAKDOWN = 'Agrega productos al carrito para ver el desglose de descuentos.';
const RECALCULATING = 'Recalculando el desglose…';

/**
 * Puntos basicos enteros a porcentaje legible: `1000` -> `10%`, `2732` -> `27.32%`.
 *
 * Es la unica division de la app y es legitima porque **no es dinero**: es la presentacion
 * de un entero en puntos basicos, no un importe. La politica de redondeo de
 * `product-rules.md` gobierna montos, y sigue prohibiendo `toFixed` sobre cualquiera de
 * ellos (FK-R3.4).
 *
 * `String` en lugar de `toFixed(2)` a proposito: el bps es exacto y su division entre 100
 * se imprime con los decimales que tenga —`35%`, no `35.00%`—, sin introducir un redondeo
 * de presentacion. La misma funcion sirve a la tasa de cada linea y al porcentaje efectivo,
 * de modo que ambos se leen con el mismo formato.
 */
const formatBps = (bps: number): string => `${String(bps / 100)}%`;

/**
 * Tabla de las tres lineas mas el pie de totales.
 *
 * Recorre `totals.lines` **en el orden en que llega**: el arreglo del contrato ya viene en
 * orden de precedencia —categoria, volumen, cupon— y reordenarlo aqui seria reimplementar
 * la precedencia de la cascada en la vista. Se pintan las tres siempre, aplicadas o no
 * (FK-R3.1): el desglose completo es lo que explica por que el descuento es el que es, y
 * una linea ausente y una no aplicada se leen igual en pantalla.
 */
const Breakdown = ({ totals }: { readonly totals: CheckoutTotals }): JSX.Element => (
  <>
    <table aria-labelledby="desglose-titulo">
      <thead>
        <tr>
          <th scope="col">Descuento</th>
          <th scope="col">Estado</th>
          <th scope="col" className="num">Tasa</th>
          <th scope="col" className="num">Monto</th>
        </tr>
      </thead>
      <tbody>
        {totals.lines.map((line) => (
          <tr key={line.name} data-testid={`breakdown-line-${line.name}`}>
            {/* El texto llega listo del backend; la UI no lo compone (FK-R3.1). */}
            <th scope="row">{line.label}</th>
            <td>
              {/*
                La etiqueta de estado es solo color y forma alrededor del mismo texto: la
                clase cambia con `applied`, nunca el contenido, que es el que se lee.
              */}
              <span className={line.applied ? 'estado estado--aplicado' : 'estado'}>
                {line.applied ? 'Aplicado' : 'No aplicado'}
              </span>
            </td>
            <td className="num">{formatBps(line.rateBps)}</td>
            <td className="num">{formatCents(line.discountCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>

    {/*
      Los tres valores salen tal cual de `CheckoutTotals` (FK-R3.3). `totalSavingsCents`
      ya viene topado y `finalTotalCents` ya viene derivado por el backend: aqui no se
      suma, no se resta y no se compara con el tope.
    */}
    <p className="total">
      <span>Descuento efectivo</span>
      <strong data-testid="breakdown-effective">
        {formatBps(totals.effectiveDiscountBps)}
      </strong>
    </p>
    <p className="total">
      <span>Ahorro total</span>
      <strong data-testid="breakdown-savings">{formatCents(totals.totalSavingsCents)}</strong>
    </p>
    <p className="total total--destacado">
      <span>Total a pagar</span>
      <strong data-testid="breakdown-total">{formatCents(totals.finalTotalCents)}</strong>
    </p>
  </>
);

export const DiscountBreakdown = (): JSX.Element => {
  const totals = useCartStore((state) => state.totals);
  const previewStatus = useCartStore((state) => state.previewStatus);
  const previewError = useCartStore((state) => state.previewError);

  return (
    <section aria-labelledby="desglose-titulo">
      <h2 id="desglose-titulo">Desglose de descuentos</h2>

      {/*
        Los dos estados de FK-R3.5, y ninguno de los dos toca el carrito: el aviso convive
        con el desglose anterior, que el store conserva a proposito. Borrar los montos por
        un fallo de red dejaria la pantalla mas pobre de lo que estaba.
      */}
      {previewStatus === 'loading' && <p role="status">{RECALCULATING}</p>}
      {previewStatus === 'error' && <p role="alert">{previewError}</p>}

      {totals === null ? <p>{NO_BREAKDOWN}</p> : <Breakdown totals={totals} />}
    </section>
  );
};
