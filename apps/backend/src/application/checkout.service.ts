import { Inject, Injectable } from '@nestjs/common';
import { DiscountDomainError, DiscountEngine, DiscountStrategyFactory } from '@core/shared';

import { findShortages, normalizeCart, type StockRequirement } from '../domain/stock';
import { PRODUCT_REPOSITORY, PURCHASE_PORT } from '../domain/tokens';

import type {
  CheckoutRequest,
  CheckoutTotals,
  DiscountCalculationInput,
  OrderConfirmation,
  OrderConfirmationItem,
  Product,
} from '@core/shared';

import type { NewOrder, NewOrderLine, PersistedOrder } from '../domain/order.repository';
import type { ProductRepository } from '../domain/product.repository';
import type { PurchaseConfirmationPort } from '../domain/purchase.port';

/**
 * Entrada del motor a partir de la peticion y del catalogo persistido.
 *
 * Existe para que `preview` y `confirm` armen el contexto de calculo con el MISMO
 * codigo: si cada uno construyera el suyo, la divergencia entre el desglose en vivo y
 * el de la orden seria una edicion de distancia. El spread condicional lo exige
 * `exactOptionalPropertyTypes`: "sin cupon" es la propiedad AUSENTE, que no es lo mismo
 * que `couponCode: undefined`.
 */
const toCalculationInput = (
  request: CheckoutRequest,
  catalog: readonly Product[],
): DiscountCalculationInput => ({
  items: request.items,
  catalog,
  ...(request.couponCode === undefined ? {} : { couponCode: request.couponCode }),
});

/**
 * Lineas de la orden a partir de las exigencias YA normalizadas (BC-R5.2): una linea
 * por producto distinto, aunque el carrito trajera el mismo producto repetido.
 *
 * `unitPriceCents` sale del catalogo leido y `lineTotalCents` es
 * `unitPriceCents x quantity`: producto de enteros, exacto y sin redondeo. Congelar
 * ahi los montos efectivamente cobrados es lo que mantiene la orden auditable si el
 * precio del catalogo cambia despues.
 *
 * El recorrido va sobre el CATALOGO y no sobre las exigencias, y no es un detalle de
 * estilo: es lo que hace el emparejamiento total sin narrowing artificial. Iterar las
 * exigencias obligaria a buscar cada producto y a inventar una rama para un
 * `undefined` que `normalizeCart` ya hizo imposible —solo produce exigencias de
 * productos presentes en el catalogo—, es decir codigo muerto que ninguna prueba
 * podria cubrir. Como efecto colateral las lineas quedan en el mismo orden ascendente
 * por `productId` que el `ProductRepository` garantiza para el catalogo, asi que la
 * orden persistida es determinista igual que la lista de deficits.
 */
const buildOrderLines = (
  requirements: readonly StockRequirement[],
  catalog: readonly Product[],
): readonly NewOrderLine[] => {
  const requestedByProduct = new Map(
    requirements.map((requirement) => [requirement.productId, requirement.requested]),
  );

  return catalog.flatMap((product) => {
    const quantity = requestedByProduct.get(product.id);
    if (quantity === undefined) {
      return [];
    }
    return [
      {
        productId: product.id,
        category: product.category,
        quantity,
        unitPriceCents: product.priceCents,
        lineTotalCents: product.priceCents * quantity,
      },
    ];
  });
};

/**
 * Mapeo del hecho persistido al contrato que cruza el cable (BC-R1.1, BC-R5.6).
 *
 * `name` se toma del catalogo leido para el calculo, porque la fila `OrderItem` no lo
 * almacena. Todo lo demas de la linea —cantidad, precio unitario y total— viene de la
 * orden persistida: es el dato que quedo escrito, no el que el servicio penso escribir.
 *
 * `createdAt` se convierte a ISO-8601 aqui: el dominio maneja `Date` y el contrato
 * declara `string`, y esta funcion es la unica frontera donde eso se traduce.
 *
 * Los totales no se recalculan ni se re-redondean: se embebe el mismo `CheckoutTotals`
 * que produjo el motor y con el que se persistio la orden, de modo que el desglose de
 * la confirmacion no pueda diferir en un centavo del que devolvio `preview`.
 */
const toOrderConfirmation = (
  persisted: PersistedOrder,
  totals: CheckoutTotals,
  catalog: readonly Product[],
): OrderConfirmation => {
  const nameByProductId = new Map(catalog.map((product) => [product.id, product.name]));

  const items: readonly OrderConfirmationItem[] = persisted.lines.map((line) => {
    const name = nameByProductId.get(line.productId);
    if (name === undefined) {
      // Guarda de frontera, no rama de negocio: el puerto es un adaptador y una orden
      // que referencia un producto ausente del catalogo leido es una inconsistencia de
      // infraestructura. Inventarle un nombre o descartar la linea corromperia el
      // comprobante en silencio, y una assertion esta prohibida.
      throw new DiscountDomainError(
        'INTERNAL_ERROR',
        `La orden persistida referencia un producto ausente del catalogo: ${line.productId}.`,
        { productId: line.productId },
      );
    }

    return {
      productId: line.productId,
      name,
      category: line.category,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
    };
  });

  return {
    orderId: persisted.id,
    createdAt: persisted.createdAt.toISOString(),
    // exactOptionalPropertyTypes: "sin cupon" es la propiedad AUSENTE, y ninguno de los
    // dos es el `null` de la columna.
    ...(persisted.couponCode === undefined ? {} : { couponCode: persisted.couponCode }),
    items,
    totals,
  };
};

/**
 * Caso de uso del checkout (BC-R3.2, BC-R6.3).
 *
 * El motor se arma desde `DiscountStrategyFactory`, asi que el servicio NO redeclara
 * tasas, umbrales, orden de precedencia, politica de redondeo ni el tope del 35%, y no
 * ejecuta ninguna operacion de redondeo sobre montos calculados: la politica completa
 * vive en `@core/shared` y tiene una sola implementacion. Es la razon estructural —no
 * la convencion— por la que `preview` y `checkout` no pueden divergir en un centavo.
 *
 * Los dos puertos entran por token, nunca por su implementacion concreta, de modo que
 * una prueba los sustituya con dobles en memoria sin tocar este archivo (BC-R6.2).
 */
@Injectable()
export class CheckoutService {
  private readonly engine = new DiscountEngine(new DiscountStrategyFactory().create());

  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PURCHASE_PORT) private readonly purchase: PurchaseConfirmationPort,
  ) {}

  /**
   * Desglose sin efectos secundarios (BC-R3.2, BC-R3.4).
   *
   * El catalogo sale del `ProductRepository`, asi que los precios usados son los
   * persistidos y no los que envio el cliente: la peticion aporta unicamente las
   * lineas y el cupon.
   *
   * NO comprueba stock y NO produce efecto alguno: una linea que pide mas unidades de
   * las disponibles obtiene igualmente su desglose, porque previsualizar no reserva ni
   * decrementa nada. El `PurchaseConfirmationPort` no se toca en este camino.
   *
   * El carrito vacio y un cupon desconocido o expirado tampoco son casos especiales
   * aqui (BC-R3.5, BC-R3.6): `resolveCart` resuelve el codigo a "sin cupon" y el motor
   * devuelve ceros con las tres lineas no aplicadas, sin excepcion y sin ramas propias
   * en el servicio.
   */
  async preview(request: CheckoutRequest): Promise<CheckoutTotals> {
    const catalog = await this.products.findAll();

    return this.engine.calculate(toCalculationInput(request, catalog));
  }

  /**
   * Compra confirmada: valida, calcula y solo despues escribe (BC-R5.2, BC-R5.6).
   *
   * La secuencia es la parte importante, no un detalle de implementacion:
   *
   * 1. Carrito vacio -> `INVALID_CART`. No es una regla de validez del carrito
   *    —`preview` lo acepta y devuelve ceros— sino del endpoint: una compra sin
   *    productos no es una orden (BC-R4.6).
   * 2. Leer el catalogo: los precios y el stock son los persistidos, nunca los del
   *    cliente.
   * 3. `engine.calculate`, que resuelve y valida el carrito antes de aplicar
   *    estrategia alguna. Va ANTES del stock a proposito (BC-R4.5): un producto
   *    inexistente responde `404 PRODUCT_NOT_FOUND` y no un `409`, y una cantidad no
   *    positiva `400 INVALID_CART`. El servicio no reimplementa esa validacion.
   * 4. Stock: `normalizeCart` suma por producto —dos lineas del mismo producto son una
   *    sola exigencia— y `findShortages` reporta TODAS las deficitarias, ordenadas,
   *    para que el usuario corrija el carrito en un solo intento (BC-R4.4).
   * 5. Armar la orden con las exigencias normalizadas y los totales del motor.
   * 6. `purchase.confirm`: decremento condicional y creacion como una sola unidad
   *    atomica. El servicio no conoce la transaccion (BC-R6.3).
   * 7. Mapear el hecho persistido al contrato de confirmacion.
   *
   * Validar y calcular antes de escribir hace que un checkout rechazado no llegue a
   * tocar la base **por construccion**. El rollback de la transaccion cubriria el caso
   * igualmente, pero que sea cierto sin necesidad de deshacer nada es lo que permite
   * afirmarlo en una prueba unitaria sin base de datos.
   *
   * Sin `try/catch`: los `DiscountDomainError` suben tal cual al `ApiExceptionFilter`,
   * que es el unico traductor a HTTP del backend (BC-R7.1, BC-R7.3). Capturarlos aqui
   * solo podria degradar el codigo tipado.
   */
  async confirm(request: CheckoutRequest): Promise<OrderConfirmation> {
    // (1)
    if (request.items.length === 0) {
      throw new DiscountDomainError(
        'INVALID_CART',
        'No se puede confirmar una compra sin productos.',
      );
    }

    // (2)
    const catalog = await this.products.findAll();

    // (3) Emite PRODUCT_NOT_FOUND (404) e INVALID_CART (400) con sus detalles.
    const totals = this.engine.calculate(toCalculationInput(request, catalog));

    // (4)
    const requirements = normalizeCart(request.items, catalog);
    const shortages = findShortages(requirements);
    if (shortages.length > 0) {
      throw new DiscountDomainError(
        'INSUFFICIENT_STOCK',
        'Alguna linea del carrito supera el stock disponible.',
        { shortages },
      );
    }

    // (5) Los montos vienen del motor: el servicio no redondea ni recompone totales.
    const order: NewOrder = {
      originalSubtotalCents: totals.originalSubtotalCents,
      totalSavingsCents: totals.totalSavingsCents,
      finalTotalCents: totals.finalTotalCents,
      capApplied: totals.capApplied,
      // El codigo presentado en la compra se persiste tal cual, aplicara o no: si fue
      // ignorado, la linea COUPON del desglose embebido ya lo dice con `applied: false`,
      // asi que la confirmacion nunca es ambigua.
      ...(request.couponCode === undefined ? {} : { couponCode: request.couponCode }),
      lines: buildOrderLines(requirements, catalog),
    };

    // (6) Puede rechazar con INSUFFICIENT_STOCK y `contendedProductIds` si el stock
    // cambio entre el paso 4 y la escritura; en ese caso no persiste nada.
    const persisted = await this.purchase.confirm(order);

    // (7)
    return toOrderConfirmation(persisted, totals, catalog);
  }
}
