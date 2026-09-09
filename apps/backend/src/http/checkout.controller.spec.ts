import { DiscountDomainError, isDiscountDomainError } from '@core/shared';

import { InMemoryProductRepository } from '../../test/doubles/in-memory-product.repository';
import {
  FIXED_CREATED_AT,
  InMemoryPurchasePort,
} from '../../test/doubles/in-memory-purchase.port';
import { CheckoutService } from '../application/checkout.service';

import { CheckoutController } from './checkout.controller';
import { CartItemDto, CheckoutRequestDto } from './checkout.dto';

import type { CheckoutRequest, CheckoutTotals, OrderConfirmation } from '@core/shared';

/**
 * Pruebas por ejemplo de `CheckoutController` (BC-R8.1).
 *
 * Lo unico que este controlador promete es orquestar: por cada invocacion, **una** sola
 * llamada al caso de uso, con el cuerpo tal como llego y devolviendo su promesa sin
 * envolverla ni remapearla. Por eso las afirmaciones son de delegacion e identidad de
 * referencias, no de montos: el calculo ya lo cubre `checkout.service.spec.ts`, y
 * repetirlo aqui solo daria la ilusion de una segunda verificacion del motor.
 *
 * Los dobles son subclases tipadas de `CheckoutService`, no espias: el compilador
 * verifica que la superficie publica coincide, asi que no hace falta `any`, ni
 * assertions, ni `@ts-ignore` (BC-R8.1). El controlador se instancia con `new`; la
 * inyeccion la resuelve `CheckoutModule` y probarla aqui verificaria el contenedor.
 *
 * Los estados HTTP —`200` en `preview` por el `@HttpCode` explicito, `201` en `confirm`
 * por el defecto de Nest— no se afirman aqui: son metadatos que solo el framework
 * interpreta, y quien los verifica de verdad es el end-to-end de la tarea 8.1.
 *
 * Requisitos: BC-R8.1.
 */

// --- Fixtures ---------------------------------------------------------------------

const cartItem = (productId: string, quantity: number): CartItemDto => {
  const dto = new CartItemDto();
  dto.productId = productId;
  dto.quantity = quantity;
  return dto;
};

/**
 * El cuerpo se construye como instancia del DTO, que es lo que el `ValidationPipe`
 * global entrega al handler. `couponCode` se asigna solo cuando existe: bajo
 * `exactOptionalPropertyTypes` "sin cupon" es la propiedad AUSENTE.
 */
const requestDto = (
  items: readonly CartItemDto[],
  couponCode?: string,
): CheckoutRequestDto => {
  const dto = new CheckoutRequestDto();
  dto.items = [...items];
  if (couponCode !== undefined) {
    dto.couponCode = couponCode;
  }
  return dto;
};

const LAPTOP_BODY = requestDto([cartItem('PROD-001', 1)]);

/**
 * Totales arbitrarios pero bien formados. Los valores no importan: lo que se afirma es
 * que llegan al cliente **exactamente** estos, sin recomponer campos ni reordenar
 * lineas. Corresponden a 1 x PROD-001 sin cupon, para que leerlos no despiste.
 */
const TOTALS: CheckoutTotals = {
  originalSubtotalCents: 129900,
  lines: [
    {
      name: 'CATEGORY',
      label: 'Descuento Tecnología (10%)',
      applied: true,
      rateBps: 1000,
      baseAmountMicros: 129_900_000_000,
      baseAmountCents: 129900,
      discountMicros: 12_990_000_000,
      discountCents: 12990,
    },
    {
      name: 'VOLUME',
      label: 'Descuento por volumen (5%)',
      applied: true,
      rateBps: 500,
      baseAmountMicros: 116_910_000_000,
      baseAmountCents: 116910,
      discountMicros: 5_845_500_000,
      discountCents: 5846,
    },
    {
      name: 'COUPON',
      label: 'Cupón no aplicado',
      applied: false,
      rateBps: 0,
      baseAmountMicros: 0,
      baseAmountCents: 0,
      discountMicros: 0,
      discountCents: 0,
    },
  ],
  rawDiscountMicros: 18_835_500_000,
  rawDiscountCents: 18836,
  capCents: 45465,
  capApplied: false,
  totalSavingsCents: 18836,
  capAdjustmentCents: 0,
  effectiveDiscountBps: 1450,
  finalTotalCents: 111064,
};

const CONFIRMATION: OrderConfirmation = {
  orderId: 'ORD-001',
  createdAt: FIXED_CREATED_AT.toISOString(),
  items: [
    {
      productId: 'PROD-001',
      name: 'Laptop Pro 14"',
      category: 'Tecnologia',
      quantity: 1,
      unitPriceCents: 129900,
      lineTotalCents: 129900,
    },
  ],
  totals: TOTALS,
};

// --- Dobles ------------------------------------------------------------------------

/**
 * Doble que cuenta las llamadas, guarda los cuerpos recibidos y devuelve **siempre la
 * misma promesa** sobre **el mismo objeto**. Esa estabilidad de referencias es lo que
 * permite afirmar que el controlador no copia, no mapea y no re-envuelve: si lo hiciera,
 * los `toBe` fallarian aunque los `toStrictEqual` siguieran pasando.
 *
 * Extiende `CheckoutService` en lugar de imitarlo, de modo que `tsc` falle si el caso de
 * uso cambia de firma y este doble se queda atras.
 */
class StubCheckoutService extends CheckoutService {
  public readonly previewBodies: CheckoutRequest[] = [];
  public readonly confirmBodies: CheckoutRequest[] = [];

  private readonly previewResult: Promise<CheckoutTotals> = Promise.resolve(TOTALS);
  private readonly confirmResult: Promise<OrderConfirmation> = Promise.resolve(CONFIRMATION);

  constructor() {
    // Los puertos del padre quedan inertes: los dos metodos estan sobrescritos y nunca
    // los consultan. Se pasan dobles reales solo porque el constructor los exige, y sus
    // contadores sirven de testigo de que este doble no los toca.
    super(new InMemoryProductRepository(), new InMemoryPurchasePort());
  }

  override preview(request: CheckoutRequest): Promise<CheckoutTotals> {
    this.previewBodies.push(request);
    return this.previewResult;
  }

  override confirm(request: CheckoutRequest): Promise<OrderConfirmation> {
    this.confirmBodies.push(request);
    return this.confirmResult;
  }
}

/**
 * Doble que rechaza con un error tipado, como lo hace el caso de uso real ante un
 * carrito invalido o stock insuficiente. Rechaza la promesa en vez de lanzar de forma
 * sincrona, que es como el error llega desde un `await` del servicio.
 */
class RejectingCheckoutService extends CheckoutService {
  public previewCalls = 0;
  public confirmCalls = 0;

  constructor(private readonly failure: DiscountDomainError) {
    super(new InMemoryProductRepository(), new InMemoryPurchasePort());
  }

  override preview(): Promise<CheckoutTotals> {
    this.previewCalls += 1;
    return Promise.reject(this.failure);
  }

  override confirm(): Promise<OrderConfirmation> {
    this.confirmCalls += 1;
    return Promise.reject(this.failure);
  }
}

/**
 * Doble que cuenta y delega en el caso de uso real, armado sobre los dobles en memoria.
 * Se usa para comprobar que la cadena completa —controlador, servicio, motor y puerto—
 * atraviesa sin que el controlador intervenga en el resultado.
 */
class DelegatingCheckoutService extends CheckoutService {
  public previewCalls = 0;
  public confirmCalls = 0;

  override preview(request: CheckoutRequest): Promise<CheckoutTotals> {
    this.previewCalls += 1;
    return super.preview(request);
  }

  override confirm(request: CheckoutRequest): Promise<OrderConfirmation> {
    this.confirmCalls += 1;
    return super.confirm(request);
  }
}

/** Captura el error tipado sin assertions: el guard hace el narrowing. */
const rejectedDomainError = async (
  run: () => Promise<unknown>,
): Promise<DiscountDomainError> => {
  try {
    await run();
  } catch (error) {
    if (isDiscountDomainError(error)) return error;
    throw error;
  }
  throw new Error('se esperaba un DiscountDomainError y la promesa se resolvio');
};

// --- Delegacion unica ---------------------------------------------------------------

describe('CheckoutController.preview: delegacion unica (BC-R3.1)', () => {
  it('una invocacion produce exactamente una llamada a preview y ninguna a confirm', async () => {
    const checkout = new StubCheckoutService();
    const controller = new CheckoutController(checkout);

    await controller.preview(LAPTOP_BODY);

    expect(checkout.previewBodies).toHaveLength(1);
    expect(checkout.confirmBodies).toHaveLength(0);
  });

  it('tres invocaciones producen tres llamadas: el controlador no cachea', async () => {
    const checkout = new StubCheckoutService();
    const controller = new CheckoutController(checkout);

    await controller.preview(LAPTOP_BODY);
    await controller.preview(LAPTOP_BODY);
    await controller.preview(LAPTOP_BODY);

    expect(checkout.previewBodies).toHaveLength(3);
  });

  it('no llama al caso de uso hasta que se invoca el handler', () => {
    const checkout = new StubCheckoutService();
    new CheckoutController(checkout);

    expect(checkout.previewBodies).toHaveLength(0);
    expect(checkout.confirmBodies).toHaveLength(0);
  });

  it('pasa el mismo cuerpo que recibio, sin copiarlo ni reconstruirlo', async () => {
    const checkout = new StubCheckoutService();
    const controller = new CheckoutController(checkout);
    const body = requestDto([cartItem('PROD-004', 2), cartItem('PROD-006', 3)], 'WELCOME2026');

    await controller.preview(body);

    // Identidad, no igualdad estructural: si el controlador armara su propio objeto
    // —normalizando lineas o rellenando el cupon— este `toBe` fallaria.
    expect(checkout.previewBodies[0]).toBe(body);
  });

  it('no inventa un couponCode cuando el cuerpo no lo trae', async () => {
    const checkout = new StubCheckoutService();
    const controller = new CheckoutController(checkout);

    await controller.preview(requestDto([cartItem('PROD-001', 1)]));

    // El cuerpo llega sin cupon y sigue sin cupon: el controlador no rellena un default
    // ni convierte la ausencia en cadena vacia, que `resolveCart` trataria como codigo
    // desconocido en vez de como "sin cupon".
    expect(checkout.previewBodies[0]?.couponCode).toBeUndefined();
  });
});

describe('CheckoutController.confirm: delegacion unica (BC-R5.1)', () => {
  it('una invocacion produce exactamente una llamada a confirm y ninguna a preview', async () => {
    const checkout = new StubCheckoutService();
    const controller = new CheckoutController(checkout);

    await controller.confirm(LAPTOP_BODY);

    expect(checkout.confirmBodies).toHaveLength(1);
    // El controlador no previsualiza antes de comprar: seria una segunda lectura del
    // catalogo y un calculo duplicado a espaldas del caso de uso.
    expect(checkout.previewBodies).toHaveLength(0);
  });

  it('dos invocaciones producen dos llamadas: no deduplica ni memoiza la orden', async () => {
    const checkout = new StubCheckoutService();
    const controller = new CheckoutController(checkout);

    await controller.confirm(LAPTOP_BODY);
    await controller.confirm(LAPTOP_BODY);

    expect(checkout.confirmBodies).toHaveLength(2);
  });

  it('pasa el mismo cuerpo que recibio, con su cupon intacto', async () => {
    const checkout = new StubCheckoutService();
    const controller = new CheckoutController(checkout);
    const body = requestDto([cartItem('PROD-005', 3)], 'DEMOCAP50');

    await controller.confirm(body);

    expect(checkout.confirmBodies[0]).toBe(body);
    expect(checkout.confirmBodies[0]?.couponCode).toBe('DEMOCAP50');
  });
});

// --- Devuelve el resultado sin transformarlo ---------------------------------------

describe('CheckoutController.preview: devuelve los totales sin transformarlos (BC-R3.3)', () => {
  it('resuelve el mismo objeto de totales que entrego el servicio', async () => {
    const controller = new CheckoutController(new StubCheckoutService());

    await expect(controller.preview(LAPTOP_BODY)).resolves.toBe(TOTALS);
  });

  it('devuelve la misma promesa que el servicio, sin envolverla', async () => {
    const controller = new CheckoutController(new StubCheckoutService());

    const first = controller.preview(LAPTOP_BODY);
    const second = controller.preview(LAPTOP_BODY);

    // El doble devuelve una promesa estable: si el controlador hiciera `await`, `then`
    // o `Promise.resolve(...)` sobre ella, estas referencias no coincidirian.
    expect(first).toBe(second);
    await expect(first).resolves.toBe(TOTALS);
  });

  it('no recorta campos ni reordena el desglose', async () => {
    const controller = new CheckoutController(new StubCheckoutService());

    const totals = await controller.preview(LAPTOP_BODY);

    expect(totals).toStrictEqual(TOTALS);
    // El orden de las lineas es contrato del motor, no del controlador: un `sort` aqui
    // seria un segundo dueno de la precedencia y este caso lo delata.
    expect(totals.lines.map((line) => line.name)).toStrictEqual([
      'CATEGORY',
      'VOLUME',
      'COUPON',
    ]);
  });
});

describe('CheckoutController.confirm: devuelve la confirmacion sin transformarla (BC-R5.5)', () => {
  it('resuelve el mismo objeto de confirmacion que entrego el servicio', async () => {
    const controller = new CheckoutController(new StubCheckoutService());

    await expect(controller.confirm(LAPTOP_BODY)).resolves.toBe(CONFIRMATION);
  });

  it('devuelve la misma promesa que el servicio, sin envolverla', async () => {
    const controller = new CheckoutController(new StubCheckoutService());

    const first = controller.confirm(LAPTOP_BODY);

    expect(first).toBe(controller.confirm(LAPTOP_BODY));
    await expect(first).resolves.toBe(CONFIRMATION);
  });

  it('no aplana los totales ni reformatea la marca temporal', async () => {
    const controller = new CheckoutController(new StubCheckoutService());

    const confirmation = await controller.confirm(LAPTOP_BODY);

    expect(confirmation).toStrictEqual(CONFIRMATION);
    // `totals` embebido, no aplanado, y `createdAt` en ISO-8601 tal como lo mando el
    // servicio: el controlador no es el dueno de ninguna de las dos decisiones.
    expect(confirmation.totals).toBe(TOTALS);
    expect(confirmation.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

// --- Sin try/catch: los errores tipados suben al filtro HTTP ------------------------

describe('CheckoutController: sin try/catch (BC-R7.2)', () => {
  it('preview propaga el mismo error tipado que rechazo el caso de uso', async () => {
    const failure = new DiscountDomainError('PRODUCT_NOT_FOUND', 'no existe', {
      productId: 'PROD-999',
    });
    const checkout = new RejectingCheckoutService(failure);
    const controller = new CheckoutController(checkout);

    // Misma instancia: capturarla y relanzar otra perderia el codigo y los detalles que
    // el `ApiExceptionFilter` necesita para elegir el estado HTTP.
    await expect(controller.preview(LAPTOP_BODY)).rejects.toBe(failure);
    expect(checkout.previewCalls).toBe(1);
  });

  it('confirm propaga el rechazo conservando codigo y detalles', async () => {
    const failure = new DiscountDomainError(
      'INSUFFICIENT_STOCK',
      'Alguna linea del carrito supera el stock disponible.',
      { shortages: [{ productId: 'PROD-005', requested: 4, available: 3 }] },
    );
    const controller = new CheckoutController(new RejectingCheckoutService(failure));

    const error = await rejectedDomainError(() => controller.confirm(LAPTOP_BODY));

    expect(error).toBe(failure);
    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.details).toStrictEqual({
      shortages: [{ productId: 'PROD-005', requested: 4, available: 3 }],
    });
  });

  it('no sustituye el fallo por un cuerpo vacio ni por totales en cero', async () => {
    const failure = new DiscountDomainError('INVALID_CART', 'cantidad no positiva');
    const controller = new CheckoutController(new RejectingCheckoutService(failure));

    await expect(controller.confirm(LAPTOP_BODY)).rejects.toThrow('cantidad no positiva');
  });
});

// --- Cadena completa contra el caso de uso real ------------------------------------

describe('CheckoutController: delega en el caso de uso real (BC-R8.1)', () => {
  it('preview atraviesa el servicio una vez y devuelve sus totales tal cual', async () => {
    const purchase = new InMemoryPurchasePort();
    const checkout = new DelegatingCheckoutService(new InMemoryProductRepository(), purchase);
    const controller = new CheckoutController(checkout);

    const totals = await controller.preview(requestDto([cartItem('PROD-001', 1)]));

    expect(checkout.previewCalls).toBe(1);
    expect(checkout.confirmCalls).toBe(0);
    // Los montos son los de `checkout.service.spec.ts`: aqui solo se comprueba que
    // llegan intactos al borde HTTP.
    expect(totals.originalSubtotalCents).toBe(129900);
    expect(totals.totalSavingsCents).toBe(18836);
    // Previsualizar no produce efectos, y el controlador no anade ninguno.
    expect(purchase.confirmCalls).toBe(0);
    expect(purchase.orders).toStrictEqual([]);
  });

  it('confirm atraviesa el servicio una vez y devuelve la orden persistida', async () => {
    const purchase = new InMemoryPurchasePort();
    const checkout = new DelegatingCheckoutService(new InMemoryProductRepository(), purchase);
    const controller = new CheckoutController(checkout);

    const confirmation = await controller.confirm(
      requestDto([cartItem('PROD-001', 1)], 'WELCOME2026'),
    );

    expect(checkout.confirmCalls).toBe(1);
    expect(checkout.previewCalls).toBe(0);
    expect(confirmation.orderId).toBe('ORD-001');
    expect(confirmation.couponCode).toBe('WELCOME2026');
    expect(confirmation.totals.totalSavingsCents).toBe(35495);
    expect(purchase.orders).toHaveLength(1);
  });
});
