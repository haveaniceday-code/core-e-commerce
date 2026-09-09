import { confirmPurchase as requestConfirmation, requestPreview } from '../api/checkout.api';
import { ApiClientError, isRecord } from '../api/http';

import type { CartState, CheckoutSliceCreator } from './state';
import type { CheckoutRequest, StockShortage } from '@core/shared';

/**
 * Slice del cupon, del desglose y de la compra (FK-R2, FK-R5.3, FK-R5.6).
 *
 * Vive en el **mismo store** que el carrito (D1 / FK-R2.1). Un segundo store obligaria a
 * sincronizar dos fuentes para una sola pantalla, y el desglose depende directamente de las
 * lineas: quien las cambia tiene que poder pedirlo sin puentes entre stores.
 *
 * **El frontend muestra, no decide.** Este archivo no contiene una sola operacion
 * aritmetica sobre dinero: no calcula descuentos, no redondea, no compara porcentajes y no
 * deduce si el tope se activo (FK-R2.7, FK-R4.4). Guarda el `CheckoutTotals` que llega y lo
 * expone tal cual. La decision del tope es `capApplied`, y viaja en la respuesta.
 */

/** Referencia estable para "sin lineas deficitarias": evita un arreglo nuevo por `set`. */
const NO_SHORTAGES: readonly StockShortage[] = [];

/** Solo se alcanzan si algo distinto de `ApiClientError` escapa del Cliente_Api. */
const PREVIEW_UNEXPECTED = 'Ocurrio un error inesperado al calcular el desglose.';
const PURCHASE_UNEXPECTED = 'Ocurrio un error inesperado al confirmar la compra.';

/**
 * Contador de secuencia de las peticiones de desglose (FK-R2.5).
 *
 * Es module-scope y no estado del store a proposito: no es informacion que la pantalla
 * consuma, y meterlo en el estado provocaria un render por cada peticion iniciada.
 *
 * Resuelve un bug real: pulsar `+` dos veces seguidas lanza dos peticiones, y si la primera
 * responde despues de la segunda, la pantalla se queda con el desglose del carrito
 * anterior. Es un contador, **no** una cancelacion ni un *debounce*: no hay volumen que
 * justifique ninguno de los dos, y la respuesta obsoleta simplemente se descarta.
 */
let previewSequence = 0;

/**
 * Cuerpo de las dos peticiones de checkout (FK-R5.6).
 *
 * Solo lineas y cupon. No hay campo donde meter un monto —`CheckoutRequest` no lo tiene—,
 * y esa ausencia es lo que hace estructuralmente cierto que el backend sea la unica fuente
 * de verdad del calculo (I7).
 *
 * El spread condicional respeta `exactOptionalPropertyTypes`: "sin cupon" es la
 * **ausencia** de la propiedad, no `couponCode: undefined`. Con la propiedad presente y en
 * `undefined`, `JSON.stringify` la omite igualmente, pero el tipo dejaria de compilar y la
 * diferencia entre "no hay cupon" y "hay un cupon que no se pudo leer" se perderia.
 */
const buildRequest = (state: CartState): CheckoutRequest => ({
  items: Object.entries(state.items).map(([productId, quantity]) => ({ productId, quantity })),
  ...(state.appliedCoupon === null ? {} : { couponCode: state.appliedCoupon }),
});

const isStockShortage = (value: unknown): value is StockShortage =>
  isRecord(value) &&
  typeof value.productId === 'string' &&
  typeof value.requested === 'number' &&
  typeof value.available === 'number';

/**
 * Estrecha las lineas deficitarias que viajan en `details` del `409` (FK-R5.4).
 *
 * `ApiClientError.details` es `Record<string, unknown>` justamente para obligar a esto:
 * quien lo lea estrecha antes de usarlo. Cero assertions —`details.shortages as
 * StockShortage[]` seria una mentira sobre datos que cruzaron la red— y cero `any`.
 *
 * Los dos `409` de stock traen detalles distintos: el de la validacion contra el catalogo
 * trae `shortages`, y el de la guarda del decremento condicional trae
 * `contendedProductIds`, porque el compare-and-swap no sabe cuanto stock quedaba. El
 * segundo cae por aqui sin `shortages` y se resuelve a la lista vacia: su mensaje ya
 * explica que el stock cambio mientras se confirmaba la compra, y no hay cifras que
 * mostrar.
 *
 * El `flatMap` descarta las entradas que no respetan la forma en lugar de rechazar el lote
 * entero: una linea ilegible no es razon para ocultarle al usuario las que si se entienden.
 */
const shortagesFrom = (
  details: Record<string, unknown> | undefined,
): readonly StockShortage[] => {
  if (details === undefined) {
    return NO_SHORTAGES;
  }
  const raw = details.shortages;
  if (!Array.isArray(raw)) {
    return NO_SHORTAGES;
  }
  return raw.flatMap<StockShortage>((entry: unknown) => (isStockShortage(entry) ? [entry] : []));
};

export const createCheckoutSlice: CheckoutSliceCreator = (set, get) => ({
  couponDraft: '',
  appliedCoupon: null,

  totals: null,
  previewStatus: 'idle',
  previewError: null,

  confirmation: null,
  purchaseStatus: 'idle',
  purchaseError: null,
  shortages: NO_SHORTAGES,

  /**
   * Guarda lo que el usuario teclea y **nada mas** (FK-R2.2). Sin peticion, sin
   * *debounce* que la retrase: HU 2 dice "ingresar el codigo y presionar Aplicar", y el
   * borrador separado del aplicado es literalmente eso.
   */
  setCouponDraft: (value: string): void => {
    set({ couponDraft: value });
  },

  /**
   * Promueve el borrador a cupon aplicado y pide el desglose (FK-R2.3).
   *
   * Un borrador en blanco resuelve a `null`, que es "sin cupon": es la forma de retirar un
   * cupon ya aplicado, y evita enviar `couponCode: ''` al backend, que no es un codigo.
   *
   * No valida el codigo. Un cupon desconocido o expirado **no es un error** (D4 /
   * FK-R2.6): el backend lo resuelve a "sin cupon" y responde `200` con la linea `COUPON`
   * en `applied: false`. Validar aqui duplicaria el catalogo de cupones en el cliente y
   * seria la primera cosa que se desincroniza.
   */
  applyCoupon: (): void => {
    const trimmed = get().couponDraft.trim();
    set({ appliedCoupon: trimmed.length === 0 ? null : trimmed });
    void get().refreshPreview();
  },

  /**
   * Pide el desglose a `POST /api/checkout/preview` y guarda los enteros que llegan.
   *
   * **Carrito vacio: no se pide nada y `totals` vuelve a `null`** (FK-R2.4). Llamar a
   * `preview` sin lineas seria un viaje de ida y vuelta para que el backend devuelva ceros,
   * y conservar el desglose anterior dejaria en pantalla el precio de un carrito que ya no
   * existe. La rama tambien avanza el contador, de modo que una peticion en vuelo lanzada
   * cuando aun habia lineas no pueda aterrizar despues y resucitar ese desglose.
   *
   * **No hay rama para el cupon invalido.** Es la ruta satisfactoria: llega `200`, se
   * guarda el desglose y la linea de cupon no aplicada es la senal (FK-R2.6). `previewError`
   * queda en `null`.
   */
  refreshPreview: async (): Promise<void> => {
    const request = buildRequest(get());

    previewSequence += 1;
    const sequence = previewSequence;

    if (request.items.length === 0) {
      set({ totals: null, previewStatus: 'idle', previewError: null });
      return;
    }

    set({ previewStatus: 'loading', previewError: null });

    try {
      const totals = await requestPreview(request);
      // Llego tarde: otra peticion la adelanto y su resultado es el vigente.
      if (sequence !== previewSequence) {
        return;
      }
      set({ totals, previewStatus: 'ready', previewError: null });
    } catch (error: unknown) {
      if (sequence !== previewSequence) {
        return;
      }
      const message = error instanceof ApiClientError ? error.message : PREVIEW_UNEXPECTED;
      // El desglose anterior se conserva junto al aviso: el carrito no se toca en ningun
      // caso, y borrar los montos por un fallo de red dejaria la pantalla mas pobre.
      set({ previewStatus: 'error', previewError: message });
    }
  },

  /**
   * Confirma la compra contra `POST /api/checkout`.
   *
   * Exito (FK-R5.3): guarda la `OrderConfirmation` —con sus totales, **sin recalcular
   * ningun monto**—, vacia `items`, devuelve `totals` a `null` por la via del carrito vacio
   * y recarga el catalogo. Esa recarga es lo que hace visible el stock ya decrementado.
   *
   * Fallo (FK-R5.4, FK-R5.5): guarda el mensaje del error tipado y las `shortages` cuando
   * el `409` las trae, y **conserva el carrito intacto** para que el usuario lo corrija y
   * reintente. El cupon aplicado tambien se conserva.
   *
   * El carrito vacio no llega a la red: el boton esta deshabilitado en ese caso (FK-R5.1),
   * y la guarda evita que una invocacion programatica pida al backend confirmar una orden
   * sin lineas.
   */
  confirmPurchase: async (): Promise<void> => {
    const request = buildRequest(get());
    if (request.items.length === 0) {
      return;
    }

    set({
      purchaseStatus: 'sending',
      purchaseError: null,
      shortages: NO_SHORTAGES,
      confirmation: null,
    });

    try {
      const confirmation = await requestConfirmation(request);
      set({
        confirmation,
        purchaseStatus: 'done',
        purchaseError: null,
        shortages: NO_SHORTAGES,
        items: {},
      });
      // Carrito vacio: la rama corta de `refreshPreview` deja `totals` en `null` y anula
      // cualquier desglose en vuelo, sin pedir nada al backend.
      void get().refreshPreview();
      await get().loadCatalog();
    } catch (error: unknown) {
      const typed = error instanceof ApiClientError ? error : null;
      set({
        purchaseStatus: 'error',
        purchaseError: typed?.message ?? PURCHASE_UNEXPECTED,
        shortages: typed === null ? NO_SHORTAGES : shortagesFrom(typed.details),
        confirmation: null,
      });
    }
  },
});
