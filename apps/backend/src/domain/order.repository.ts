/**
 * Forma de la orden en el dominio: lo que `PurchaseConfirmationPort` recibe y
 * devuelve. La interfaz `OrderRepository` que vivia aqui se elimino (BC-R6.5, D4):
 * quedo subsumida por el puerto, porque su `create` no podia ejecutarse fuera de la
 * transaccion del decremento sin filtrar el cliente transaccional a su firma. Los
 * tipos se conservan intactos: son el contrato que el schema Prisma ya modela.
 *
 * `createdAt` es `Date` a proposito. Es el tipo del dominio; la conversion a
 * ISO-8601 ocurre al mapear a `OrderConfirmation`, que es lo que cruza el cable.
 */
import type { ProductCategory } from '@core/shared';

/** Linea de orden ya resuelta, con todos los montos en centavos enteros. */
export interface NewOrderLine {
  readonly productId: string;
  readonly category: ProductCategory;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
}

export interface NewOrder {
  readonly originalSubtotalCents: number;
  readonly totalSavingsCents: number;
  readonly finalTotalCents: number;
  readonly capApplied: boolean;
  readonly couponCode?: string;
  readonly lines: readonly NewOrderLine[];
}

export interface PersistedOrder extends NewOrder {
  readonly id: string;
  readonly createdAt: Date;
}
