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

/**
 * Interfaz declarada, sin implementacion concreta y sin doble de prueba en esta
 * entrega (D1 / BP-R4.2): no existe todavia un consumidor que la resuelva. Queda
 * escrita porque fija la forma de la orden persistida —montos en centavos enteros,
 * `capApplied` y `couponCode` opcional— que el schema Prisma ya modela, y porque el
 * puerto declarado en el dominio es lo que permite que el checkout llegue despues
 * sin tocar `application` ni `http`.
 */
export interface OrderRepository {
  create(order: NewOrder): Promise<PersistedOrder>;
}
