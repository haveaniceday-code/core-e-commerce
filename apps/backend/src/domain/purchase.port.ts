import type { NewOrder, PersistedOrder } from './order.repository';

/**
 * Puerto de confirmacion de compra (BC-R6.1, D4).
 *
 * Una sola operacion, no dos. El decremento de stock y la creacion de la orden son
 * una unidad atomica, asi que no pueden repartirse en dos metodos: `create` tendria
 * que recibir el cliente transaccional para ejecutarse dentro de la misma
 * transaccion, y eso filtraria Prisma a la firma del dominio, que es exactamente la
 * dependencia que el puerto existe para evitar. Por eso `OrderRepository` queda
 * subsumido y eliminado (BC-R6.5).
 *
 * Se declara en terminos de `@core/shared` y de los tipos de orden del dominio: sin
 * Prisma, sin transacciones concretas, sin tipos generados por el ORM. El adaptador
 * concreto elige la estrategia (compare-and-swap dentro de `$transaction`); el caso
 * de uso solo conoce esta firma, y por eso se prueba con un doble en memoria.
 */
export interface PurchaseConfirmationPort {
  /**
   * Decrementa el stock de todas las lineas y crea la orden como UNA unidad atomica.
   * Rechaza con `DiscountDomainError('INSUFFICIENT_STOCK', ...)` cuando alguna
   * actualizacion condicional no afecto fila, sin persistir nada.
   */
  confirm(order: NewOrder): Promise<PersistedOrder>;
}
