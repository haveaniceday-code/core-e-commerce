import { Injectable } from '@nestjs/common';

import { verifyStockDecrements, type StockDecrementOutcome } from '../../domain/stock';

import { PrismaService } from './prisma.service';

import type { NewOrder, PersistedOrder } from '../../domain/order.repository';
import type { PurchaseConfirmationPort } from '../../domain/purchase.port';

/**
 * Adaptador Prisma del `PurchaseConfirmationPort` (BC-R5.3, BC-R5.4, BC-R6.4).
 *
 * El acceso a datos entra por el provider `PrismaService`, que es el unico
 * instanciador de `PrismaClient` del proceso (BC-R6.4): aqui no se construye cliente
 * propio, asi que la conexion sigue siendo un singleton y las pruebas pueden sustituir
 * el modulo completo.
 *
 * Sin migracion: el schema de `backend-persistence` ya modela `Order` y `OrderItem` con
 * todo lo necesario (BC-R6.5, D5).
 *
 * **El adaptador no decide nada.** Emite las actualizaciones condicionales, junta sus
 * `count` y delega el veredicto en `verifyStockDecrements`, que vive en el dominio
 * precisamente para quedar dentro de la medicion de cobertura (BC-R6.6). Lo unico que
 * este archivo elige es *como* se ejecuta la unidad atomica, que es su trabajo.
 */
@Injectable()
export class PrismaPurchaseConfirmation implements PurchaseConfirmationPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Decremento de stock y creacion de la orden como UNA unidad atomica (BC-R5.3).
   *
   * Dos propiedades sostienen la correccion, y ninguna depende del nivel de aislamiento
   * de SQLite (BC-R5.4, D2):
   *
   * - **La condicion y la escritura son la misma operacion.** `stock: { gte: quantity }`
   *   en el `where` convierte el decremento en un compare-and-swap: si otra transaccion
   *   se llevo las unidades entre la validacion del caso de uso y esta escritura, la
   *   fila deja de cumplir la condicion y `count` vale `0`. No hay ventana entre leer y
   *   escribir porque no se lee.
   * - **`decrement` es atomico**: se traduce a `SET stock = stock - ?`, no a un
   *   leer-modificar-escribir en el proceso.
   *
   * `verifyStockDecrements` lanza `DiscountDomainError('INSUFFICIENT_STOCK', ...)` con
   * los `contendedProductIds` cuando alguna actualizacion no afecto fila. Lanzar dentro
   * del callback aborta la transaccion entera: los decrementos ya emitidos se revierten
   * y la orden no llega a crearse, asi que no queda estado intermedio persistido.
   *
   * La orden se crea con sus lineas anidadas en la MISMA transaccion, despues de la
   * guarda: un `create` fuera de ella podria dejar una orden sin su decremento, que es
   * exactamente el estado inconsistente que el puerto existe para hacer imposible.
   *
   * `select` en lugar de `include`: de la base solo se toman `id` y `createdAt`, los dos
   * valores que el motor genera. El resto de `PersistedOrder` es la `NewOrder` que se
   * acaba de escribir, y no es un atajo: `OrderItem` no almacena `category`, asi que las
   * lineas no podrian reconstruirse desde la fila sin volver a unir con `Product` para
   * recuperar un dato que ya se tiene y que se escribio en esta misma transaccion.
   */
  confirm(order: NewOrder): Promise<PersistedOrder> {
    return this.prisma.$transaction(async (tx) => {
      const outcomes: StockDecrementOutcome[] = [];

      for (const line of order.lines) {
        // Secuencial a proposito: las actualizaciones comparten transaccion, y
        // paralelizarlas sobre una unica conexion no las haria mas rapidas.
        const { count } = await tx.product.updateMany({
          where: { id: line.productId, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });

        outcomes.push({
          productId: line.productId,
          requested: line.quantity,
          affectedRows: count,
        });
      }

      verifyStockDecrements(outcomes); // lanza => rollback de todo

      const created = await tx.order.create({
        data: {
          originalSubtotalCents: order.originalSubtotalCents,
          totalSavingsCents: order.totalSavingsCents,
          finalTotalCents: order.finalTotalCents,
          capApplied: order.capApplied,
          // Frontera de representacion, no decision de negocio: el dominio expresa
          // "sin cupon" con la propiedad ausente y la columna lo expresa con NULL.
          // Es la unica rama del archivo, y es la razon por la que NO se excluye de la
          // medicion de cobertura (BC-R8.11).
          couponCode: order.couponCode ?? null,
          items: {
            create: order.lines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitPriceCents: line.unitPriceCents,
              lineTotalCents: line.lineTotalCents,
            })),
          },
        },
        select: { id: true, createdAt: true },
      });

      return { ...order, id: created.id, createdAt: created.createdAt };
    });
  }
}
