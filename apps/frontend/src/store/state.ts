import type {
  CheckoutTotals,
  OrderConfirmation,
  Product,
  StockShortage,
} from '@core/shared';
import type { StateCreator } from 'zustand';

/**
 * Forma del Store_Compra: los tipos de sus dos slices y el estado que resulta de unirlos.
 *
 * Este archivo existe por el umbral que el diseno de `frontend-checkout` dejo escrito:
 * `cart.store.ts` se mantiene en un solo archivo mientras no pase de ~250 lineas, y al
 * sumarle el cupon, el desglose y la compra lo pasa. La particion es en **slices de
 * Zustand dentro del mismo store** (D1): un unico `create`, un unico estado y una unica
 * suscripcion. No hay un segundo store que sincronizar.
 *
 * Los tipos viven aparte de las implementaciones para que la dependencia sea un arbol y no
 * un ciclo: `cart.slice.ts` y `checkout.slice.ts` necesitan `CartState` completo —el
 * carrito invoca `refreshPreview`, que es del otro slice— y `cart.store.ts` necesita a los
 * dos. Si `CartState` se declarara en `cart.store.ts`, cada slice importaria de quien lo
 * importa.
 */

/** Fase de la carga del catalogo. La pantalla ramifica sobre esto, no sobre `catalog.length`. */
export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Fase de la peticion del desglose (FK-R3.5). `'idle'` es tambien el estado del carrito
 * vacio, donde no hay desglose que pedir ni que conservar.
 */
export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Fase de la confirmacion de la compra (FK-R5.1). */
export type PurchaseStatus = 'idle' | 'sending' | 'done' | 'error';

/**
 * Linea del carrito ya resuelta contra el catalogo. Es lo que la pantalla consume: el
 * producto completo mas la cantidad. No se almacena en el estado, se deriva.
 */
export interface CartLine {
  readonly product: Product;
  readonly quantity: number;
}

/**
 * Catalogo, lineas del carrito y sus acciones (FC-R3).
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
 */
export interface CartSlice {
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

/**
 * Cupon, desglose y confirmacion de la orden (FK-R2, FK-R5).
 *
 * **Sin campos derivados de dinero.** No hay descuento, ni ahorro, ni total: todo eso vive
 * dentro de `totals`, tal como el backend lo calculo. El slice no recalcula descuentos, no
 * re-redondea y no deriva totales (FK-R2.7); expone los enteros de `CheckoutTotals` como
 * llegan, y la unica aritmetica de dinero del frontend sigue siendo el subtotal optimista
 * de `selectSubtotalCents`.
 */
export interface CheckoutSlice {
  /** Lo que el usuario teclea. Cambiarlo **no** dispara peticiones (FK-R2.2). */
  readonly couponDraft: string;
  /** Lo que quedo aplicado. Cambiarlo **si** dispara el desglose (FK-R2.2, FK-R2.3). */
  readonly appliedCoupon: string | null;

  /** Desglose del backend, o `null` con el carrito vacio y antes del primer calculo. */
  readonly totals: CheckoutTotals | null;
  readonly previewStatus: PreviewStatus;
  readonly previewError: string | null;

  readonly confirmation: OrderConfirmation | null;
  readonly purchaseStatus: PurchaseStatus;
  readonly purchaseError: string | null;
  /** Lineas deficitarias del `409` de stock. Vacio cuando el fallo es de otra causa. */
  readonly shortages: readonly StockShortage[];

  setCouponDraft(value: string): void;
  applyCoupon(): void;
  refreshPreview(): Promise<void>;
  confirmPurchase(): Promise<void>;
}

/**
 * Estado completo del Store_Compra. Los selectores y los componentes leen de este tipo, de
 * modo que la particion en slices es invisible desde fuera del directorio `store/`.
 */
export type CartState = CartSlice & CheckoutSlice;

/**
 * Creadores de slice tipados sobre el estado **completo**, no sobre el propio slice.
 *
 * Es lo que permite el acceso entre slices sin acoplarlos por importacion: `add` invoca
 * `get().refreshPreview()` porque su `get` devuelve `CartState`, y `confirmPurchase`
 * invoca `get().loadCatalog()` por la misma razon. Cada slice sigue declarando solo los
 * campos que produce —el cuarto parametro de `StateCreator`—, asi que ninguno puede
 * inicializar el estado del otro por accidente.
 */
export type CartSliceCreator = StateCreator<CartState, [], [], CartSlice>;
export type CheckoutSliceCreator = StateCreator<CartState, [], [], CheckoutSlice>;
