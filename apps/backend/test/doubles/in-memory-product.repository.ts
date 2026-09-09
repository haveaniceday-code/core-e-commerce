import { CATALOG_PRODUCTS, type Product } from '@core/shared';

import type { ProductRepository } from '../../src/domain/product.repository';
import { sortByProductId } from '../../src/domain/product-order';

/**
 * Doble en memoria de `ProductRepository` (BP-R6.2).
 *
 * Dos decisiones deliberadas:
 *
 * 1. `findAll` ordena con `sortByProductId`, el mismo comparador que usa el dominio.
 *    El orden ascendente por `id` es parte del contrato de la interfaz, no del
 *    `orderBy` de Prisma: si el doble devolviera las filas tal como se le pasaron,
 *    el e2e podria pasar afirmando un orden que produccion no garantiza.
 * 2. Cuenta las llamadas para que las pruebas puedan afirmar que el caso de uso
 *    delega una sola vez por invocacion, sin recurrir a un espia no tipado.
 *
 * Sin `any`, sin assertions y sin `@ts-ignore`: el compilador verifica que la
 * interfaz del dominio es implementable.
 */
export class InMemoryProductRepository implements ProductRepository {
  public findAllCalls = 0;
  public findByIdCalls = 0;

  constructor(private readonly rows: readonly Product[] = CATALOG_PRODUCTS) {}

  findAll(): Promise<readonly Product[]> {
    this.findAllCalls += 1;
    return Promise.resolve(sortByProductId(this.rows));
  }

  findById(id: string): Promise<Product | undefined> {
    this.findByIdCalls += 1;
    return Promise.resolve(this.rows.find((p) => p.id === id));
  }
}

/**
 * Doble que siempre falla, para ejercitar el camino de error interno del filtro HTTP
 * (BP-R5.7): rechaza la promesa en lugar de lanzar de forma sincrona, que es como
 * fallaria un adaptador real contra la base de datos.
 *
 * El error se recibe por constructor para que cada prueba elija su carga (mensaje con
 * ruta del `.db`, fragmento de SQL o traza) y verifique que nada de eso se filtra en
 * la respuesta.
 */
export class FailingProductRepository implements ProductRepository {
  constructor(private readonly error: Error) {}

  findAll(): Promise<readonly Product[]> {
    return Promise.reject(this.error);
  }

  findById(): Promise<Product | undefined> {
    return Promise.reject(this.error);
  }
}
