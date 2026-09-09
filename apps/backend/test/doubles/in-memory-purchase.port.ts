import { CATALOG_PRODUCTS, type Product } from '@core/shared';

import type { NewOrder, PersistedOrder } from '../../src/domain/order.repository';
import type { PurchaseConfirmationPort } from '../../src/domain/purchase.port';
import { verifyStockDecrements, type StockDecrementOutcome } from '../../src/domain/stock';

/**
 * Doble en memoria de `PurchaseConfirmationPort` (BC-R8.1, BC-R8.2, BC-R8.9).
 *
 * Reemplaza a `PrismaPurchaseConfirmation` en las pruebas del caso de uso y en el
 * end-to-end, de modo que la suite corre sin base de datos. Cuatro decisiones
 * deliberadas:
 *
 * 1. **La guarda pasa por `verifyStockDecrements`, la misma funcion del dominio que
 *    usa el adaptador Prisma.** El doble no reimplementa el rechazo: produce los
 *    `StockDecrementOutcome` igual que el adaptador produce los `count` de
 *    `updateMany` y delega la decision. Asi el error que ve el caso de uso —codigo,
 *    mensaje y `contendedProductIds`— es identico en prueba y en produccion; si el
 *    doble tuviera su propio `throw`, la prueba verificaria el doble en vez de la
 *    guarda.
 * 2. **Primero se evalua todo, despues se escribe.** El adaptador real muta fila a
 *    fila y confia en el rollback de la transaccion; aqui no hay transaccion que
 *    revertir, asi que la atomicidad se consigue calculando los resultados sobre una
 *    copia y confirmandolos solo si la guarda no lanzo. El efecto observable es el
 *    mismo, que es lo unico que la prueba puede afirmar: un rechazo deja el almacen
 *    intacto y sin orden (BC-R8.2, I3, I7).
 * 3. **Registra decrementos y ordenes, no solo contadores.** Afirmar que *no* hubo
 *    efectos exige poder inspeccionarlos: `decrements` y `orders` quedan vacios en el
 *    camino de rechazo, y `confirmCalls` distingue "no se llamo" de "se llamo y no
 *    escribio", que son fallos distintos.
 * 4. **`id` y `createdAt` son deterministas.** Un `Date.now()` o un uuid harian que
 *    el e2e no pudiera afirmar el cuerpo de la respuesta sin comodines.
 *
 * Sin `any`, sin assertions de tipo y sin `@ts-ignore`: el compilador verifica que el
 * puerto del dominio es implementable.
 */

/** Decremento efectivamente aplicado al almacen. Registro, no comportamiento. */
export interface AppliedStockDecrement {
  readonly productId: string;
  readonly quantity: number;
  readonly stockBefore: number;
  readonly stockAfter: number;
}

/**
 * Instante fijo de creacion de las ordenes del doble. Fijo a proposito: el contrato
 * expone `createdAt` como ISO-8601 y las pruebas lo comparan por igualdad.
 */
export const FIXED_CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

export interface InMemoryPurchaseOptions {
  /** Catalogo del que se toma el stock inicial. Por defecto, el seed real. */
  readonly catalog?: readonly Product[];
  /**
   * Modo de fallo: productos cuya actualizacion condicional se reporta con
   * `affectedRows: 0` aunque el stock alcance, para ejercitar la guarda del
   * compare-and-swap sin base de datos (BC-R8.9). Emula la carrera en la que otra
   * transaccion se llevo las unidades entre la validacion y la escritura, que es
   * irreproducible de otro modo en una prueba unitaria.
   */
  readonly contendedProductIds?: readonly string[];
  /** Instante de creacion de las ordenes. Por defecto, `FIXED_CREATED_AT`. */
  readonly createdAt?: Date;
}

export class InMemoryPurchasePort implements PurchaseConfirmationPort {
  /** Invocaciones recibidas, escriban o no. */
  public confirmCalls = 0;

  private readonly stock: Map<string, number>;
  private readonly contendedProductIds: ReadonlySet<string>;
  private readonly createdAt: Date;
  private readonly appliedDecrements: AppliedStockDecrement[] = [];
  private readonly persistedOrders: PersistedOrder[] = [];

  constructor(options: InMemoryPurchaseOptions = {}) {
    const catalog = options.catalog ?? CATALOG_PRODUCTS;
    this.stock = new Map(catalog.map((product) => [product.id, product.stock]));
    this.contendedProductIds = new Set(options.contendedProductIds ?? []);
    this.createdAt = options.createdAt ?? FIXED_CREATED_AT;
  }

  /** Decrementos aplicados, en orden. Vacio cuando la unidad aborto. */
  get decrements(): readonly AppliedStockDecrement[] {
    return this.appliedDecrements;
  }

  /** Ordenes persistidas, en orden. Vacio cuando la unidad aborto. */
  get orders(): readonly PersistedOrder[] {
    return this.persistedOrders;
  }

  /** Stock actual de un producto. `undefined` si no esta en el almacen. */
  stockOf(productId: string): number | undefined {
    return this.stock.get(productId);
  }

  /** Copia del almacen completo, para comparar contra el estado inicial. */
  snapshotStock(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.stock);
  }

  confirm(order: NewOrder): Promise<PersistedOrder> {
    this.confirmCalls += 1;

    // Fase de evaluacion: sobre una copia, sin tocar el almacen. Equivale al
    // `updateMany` condicional del adaptador, cuyo `count` es 1 cuando la fila
    // cumplia `stock >= quantity` y 0 cuando no.
    const pending = new Map(this.stock);
    const outcomes: StockDecrementOutcome[] = [];
    const decrements: AppliedStockDecrement[] = [];

    for (const line of order.lines) {
      const stockBefore = pending.get(line.productId);
      const misses =
        stockBefore === undefined ||
        stockBefore < line.quantity ||
        this.contendedProductIds.has(line.productId);

      if (misses) {
        outcomes.push({
          productId: line.productId,
          requested: line.quantity,
          affectedRows: 0,
        });
        continue;
      }

      outcomes.push({ productId: line.productId, requested: line.quantity, affectedRows: 1 });

      const stockAfter = stockBefore - line.quantity;
      pending.set(line.productId, stockAfter);
      decrements.push({
        productId: line.productId,
        quantity: line.quantity,
        stockBefore,
        stockAfter,
      });
    }

    // La guarda del dominio decide, dentro de la cadena de promesas. Se ejecuta aqui
    // y no antes del `return` por una razon de forma: el `throw` sincrono de
    // `verifyStockDecrements` se convierte asi en un RECHAZO, que es como el error
    // llega desde el `$transaction` del adaptador real. Un doble que lanzara de forma
    // sincrona obligaria al caso de uso a capturarlo de otro modo.
    //
    // Si lanza, nada de lo evaluado se confirma: el almacen sigue siendo el de antes
    // y no hay orden (I3, I7).
    return Promise.resolve().then(() => {
      verifyStockDecrements(outcomes);

      // Fase de confirmacion.
      for (const [productId, remaining] of pending) {
        this.stock.set(productId, remaining);
      }
      this.appliedDecrements.push(...decrements);

      const persisted: PersistedOrder = {
        ...order,
        id: `ORD-${String(this.persistedOrders.length + 1).padStart(3, '0')}`,
        createdAt: this.createdAt,
      };
      this.persistedOrders.push(persisted);

      return persisted;
    });
  }
}
