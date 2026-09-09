/**
 * Contratos de la peticion de checkout y de la confirmacion de orden
 * (BC-R1.1 - BC-R1.5).
 *
 * Viven en el paquete compartido porque los consumen las dos puntas: el DTO
 * decorado del backend declara `implements CheckoutRequest`, de modo que `tsc`
 * verifica en compilacion que la clase validada no se separe del contrato que
 * el frontend consume.
 */
import type { ProductCategory } from './categories';
import type { CartItem } from './product';
import type { CheckoutTotals } from './discount.contracts';

/**
 * Cuerpo de `POST /api/checkout/preview` y de `POST /api/checkout` (BC-R1.1).
 *
 * El cliente declara QUE quiere comprar y con que cupon; nunca montos. No hay
 * campo de subtotal, descuento ni total: el backend es la unica fuente de verdad
 * del calculo, y esa ausencia es lo que lo hace estructuralmente cierto.
 *
 * `couponCode` ausente significa "sin cupon" bajo exactOptionalPropertyTypes.
 */
export interface CheckoutRequest {
  readonly items: readonly CartItem[];
  readonly couponCode?: string;
}

/**
 * Linea de la orden confirmada (BC-R1.3).
 *
 * `name` y `category` se toman del catalogo que el servicio ya leyo para el
 * calculo, porque la fila `OrderItem` no los almacena. `unitPriceCents` y
 * `lineTotalCents` provienen de la orden persistida: son los montos
 * efectivamente cobrados, congelados en la fila para que la orden siga siendo
 * auditable si el precio del catalogo cambia despues.
 *
 * Ambos son enteros en centavos, y `quantity` un entero positivo. La restriccion
 * no es expresable en el tipo estructural: la garantiza la validacion en runtime.
 */
export interface OrderConfirmationItem {
  readonly productId: string;
  readonly name: string;
  /** Literal sin tilde; la tilde vive solo en CATEGORY_LABEL. */
  readonly category: ProductCategory;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
}

/**
 * Cuerpo de la respuesta `201` de `POST /api/checkout` (BC-R1.1, BC-R1.2).
 *
 * El campo de lineas se llama `items` y no `lines` porque `CheckoutTotals.lines`
 * ya son las `DiscountLine[]` del desglose: dos `lines` con significados
 * distintos en la misma respuesta seria una confusion garantizada. `items`
 * ademas calca la relacion `Order.items` del schema.
 */
export interface OrderConfirmation {
  readonly orderId: string;
  /**
   * ISO-8601. Nunca `Date`: el contrato describe lo que cruza el cable tras
   * `JSON.stringify`, no el tipo que devuelve el ORM.
   */
  readonly createdAt: string;
  /**
   * Ausente = sin cupon. Bajo exactOptionalPropertyTypes ausente no es lo mismo
   * que `undefined`, y ninguno de los dos es el `null` de la columna de Prisma:
   * la traduccion es responsabilidad del mapeo, no del contrato.
   */
  readonly couponCode?: string;
  readonly items: readonly OrderConfirmationItem[];
  /**
   * `CheckoutTotals` embebido, no aplanado (BC-R1.2): una sola declaracion de la
   * forma del desglose sirve a `preview` y a `checkout`, y el componente de
   * desglose del frontend vale para ambos sin ramas.
   */
  readonly totals: CheckoutTotals;
}

/**
 * Forma de los detalles del `409 INSUFFICIENT_STOCK` emitido por la validacion
 * contra el snapshot del catalogo (BC-R1.5).
 *
 * Se declara aqui, y no en el backend, para que quien produce el error y quien
 * lo renderiza lean la misma estructura sin redeclararla.
 */
export interface StockShortage {
  readonly productId: string;
  readonly requested: number;
  readonly available: number;
}
