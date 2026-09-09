import 'reflect-metadata';

import { Server } from 'node:net';

import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DISCOUNT_NAMES, ERROR_CODES } from '@core/shared';
import request from 'supertest';

import { isProductCategory } from '../src/domain/product-mapper';
import { PRODUCT_REPOSITORY, PURCHASE_PORT } from '../src/domain/tokens';
import { ApiExceptionFilter } from '../src/http/api-exception.filter';
import { CheckoutModule } from '../src/http/checkout.module';
import { PrismaService } from '../src/infra/prisma/prisma.service';

import { InMemoryProductRepository } from './doubles/in-memory-product.repository';
import { FIXED_CREATED_AT, InMemoryPurchasePort } from './doubles/in-memory-purchase.port';

import type { INestApplication } from '@nestjs/common';
import type {
  ApiError,
  CheckoutTotals,
  DiscountLine,
  DiscountName,
  ErrorCode,
  OrderConfirmation,
  OrderConfirmationItem,
} from '@core/shared';

/**
 * Prueba end-to-end de `POST /api/checkout/preview` y `POST /api/checkout` (BC-R8.10;
 * BC-R2.3, BC-R4.3, BC-R5.7, BC-R7.1).
 *
 * Arranca `CheckoutModule` completo —controlador, `CheckoutService`, DTO decorado,
 * prefijo global, `ValidationPipe` y filtro de excepciones— y sustituye **solo** la
 * frontera de persistencia. Lo que esta prueba aporta sobre las unitarias no es el
 * calculo, que ya esta cubierto en `checkout.service.spec.ts`, sino las tres piezas que
 * unicamente existen atravesando HTTP: el codigo de estado, la serializacion JSON del
 * cuerpo y el `ValidationPipe`.
 *
 * **Sin base de datos**, por tres sustituciones:
 *
 * 1. `PRODUCT_REPOSITORY` -> `InMemoryProductRepository`, asi que
 *    `PrismaProductRepository` nunca se instancia.
 * 2. `PURCHASE_PORT` -> `InMemoryPurchasePort`, asi que `PrismaPurchaseConfirmation` no
 *    abre transaccion alguna. El doble delega la guarda del compare-and-swap en la misma
 *    `verifyStockDecrements` del dominio que usa el adaptador real.
 * 3. `PrismaService` -> doble inerte, y no es opcional: `CheckoutModule` importa
 *    `PrismaModule`, asi que Nest construiria el provider y su `onModuleInit` llamaria a
 *    `$connect`, que exige `DATABASE_URL` y un archivo `.db`. Los dos bindings viven en un
 *    unico modulo (BC-R6.2) y por eso las tres lineas de `.overrideProvider()` bastan: ni
 *    el dominio, ni el caso de uso, ni el controlador se tocan.
 *
 * Pruebas por ejemplo, con montos fijos verificables a mano contra el catalogo canonico.
 * Sin generadores.
 */

/**
 * Doble inerte del provider Prisma. No implementa `PrismaService`: los delegados
 * generados por Prisma tienen tipos enormes y declararlos exigiria una assertion, que
 * esta prohibida. Expone las tres superficies que el adaptador usaria y las tres lanzan:
 * si una regresion volviera a enrutar el checkout por Prisma, la prueba falla con un
 * mensaje explicito en lugar de intentar abrir la base.
 */
const noDatabase = (): never => {
  throw new Error('el e2e corre sin base de datos: nadie debe consultar Prisma');
};

class UnreachablePrismaService {
  readonly product = { findMany: noDatabase, updateMany: noDatabase };
  readonly order = { create: noDatabase };
  readonly $transaction = noDatabase;
}

/**
 * El `getHttpServer()` de Nest devuelve `any`; el `instanceof` lo estrecha sin
 * assertions. Se comprueba contra `net.Server` —la clase base de `http.Server`— porque es
 * exactamente el tipo que acepta supertest y su narrowing no arrastra los genericos `any`
 * de `http.Server`.
 */
const httpServerOf = (app: INestApplication): Server => {
  const server: unknown = app.getHttpServer();
  if (server instanceof Server) return server;
  throw new Error('la aplicacion de prueba no expuso un servidor HTTP de node');
};

const PREVIEW_ROUTE = '/api/checkout/preview';
const CHECKOUT_ROUTE = '/api/checkout';

interface Harness {
  readonly server: Server;
  readonly products: InMemoryProductRepository;
  readonly purchase: InMemoryPurchasePort;
}

let app: INestApplication | undefined;

/**
 * Monta la aplicacion **igual que el bootstrap** de `main.ts`: prefijo `api`,
 * `ValidationPipe` con `whitelist`, `forbidNonWhitelisted` y `transform`, y
 * `ApiExceptionFilter` global. Que la configuracion del pipe sea la misma es lo que hace
 * que el `400` afirmado aqui sea el mismo `400` que devolvera produccion; con otras
 * opciones la prueba verificaria una aplicacion que no existe.
 *
 * Los dos dobles comparten el catalogo canonico: el repositorio entrega los precios y el
 * stock que el caso de uso lee, y el puerto arranca con ese mismo stock.
 */
const startApp = async (): Promise<Harness> => {
  const products = new InMemoryProductRepository();
  const purchase = new InMemoryPurchasePort();

  const moduleRef = await Test.createTestingModule({ imports: [CheckoutModule] })
    .overrideProvider(PRODUCT_REPOSITORY)
    .useValue(products)
    .overrideProvider(PURCHASE_PORT)
    .useValue(purchase)
    .overrideProvider(PrismaService)
    .useValue(new UnreachablePrismaService())
    .compile();

  const created = moduleRef.createNestApplication({ logger: false });
  created.setGlobalPrefix('api');
  created.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  created.useGlobalFilters(new ApiExceptionFilter());
  await created.init();

  app = created;
  return { server: httpServerOf(created), products, purchase };
};

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

// ---------------------------------------------------------------------------
// Lectura tipada del cuerpo JSON.
//
// `response.body` de superagent es `any`, asi que se asigna a `unknown` y se estrecha
// con predicados antes de compararlo. La validacion no es ceremonia: ES la afirmacion de
// "la forma `CheckoutTotals`" y "la forma `OrderConfirmation`" del requisito. Comprobar
// las claves exactas es lo que detecta un campo de mas o de menos tras la
// serializacion, que es justo lo que un `toMatchObject` dejaria pasar.
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const readInt = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${what} debe viajar como entero JSON: ${JSON.stringify(value)}`);
  }
  return value;
};

const readString = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${what} debe viajar como cadena no vacia: ${JSON.stringify(value)}`);
  }
  return value;
};

const readBoolean = (value: unknown, what: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error(`${what} debe viajar como booleano JSON: ${JSON.stringify(value)}`);
  }
  return value;
};

/** Claves exactas: ni ajenas ni faltantes. Las opcionales pueden no estar. */
const expectExactKeys = (
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  what: string,
): void => {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  const foreign = keys.filter((key) => !allowed.has(key)).sort();
  const missing = required.filter((key) => !keys.includes(key));

  if (foreign.length > 0 || missing.length > 0) {
    throw new Error(
      `${what} no respeta el contrato: claves ajenas [${foreign.join(', ')}], faltantes [${missing.join(', ')}]`,
    );
  }
};

const DISCOUNT_LINE_KEYS = [
  'name',
  'label',
  'applied',
  'rateBps',
  'baseAmountMicros',
  'baseAmountCents',
  'discountMicros',
  'discountCents',
] as const;

/** Recorre la union canonica en lugar de redeclararla. */
const isDiscountName = (value: unknown): value is DiscountName =>
  DISCOUNT_NAMES.some((name: DiscountName) => name === value);

const readDiscountLine = (value: unknown): DiscountLine => {
  if (!isRecord(value)) {
    throw new Error(`la linea del desglose no es un objeto JSON: ${JSON.stringify(value)}`);
  }
  expectExactKeys(value, DISCOUNT_LINE_KEYS, [], 'DiscountLine');

  const { name } = value;
  if (!isDiscountName(name)) {
    throw new Error(`el nombre de la linea no es un DISCOUNT_NAMES: ${JSON.stringify(name)}`);
  }

  return {
    name,
    // No vacio incluso con `applied: false`: la UI muestra el desglose completo.
    label: readString(value.label, 'DiscountLine.label'),
    applied: readBoolean(value.applied, 'DiscountLine.applied'),
    rateBps: readInt(value.rateBps, 'DiscountLine.rateBps'),
    baseAmountMicros: readInt(value.baseAmountMicros, 'DiscountLine.baseAmountMicros'),
    baseAmountCents: readInt(value.baseAmountCents, 'DiscountLine.baseAmountCents'),
    discountMicros: readInt(value.discountMicros, 'DiscountLine.discountMicros'),
    discountCents: readInt(value.discountCents, 'DiscountLine.discountCents'),
  };
};

const CHECKOUT_TOTALS_KEYS = [
  'originalSubtotalCents',
  'lines',
  'rawDiscountMicros',
  'rawDiscountCents',
  'capCents',
  'capApplied',
  'totalSavingsCents',
  'effectiveDiscountBps',
  'finalTotalCents',
] as const;

const readCheckoutTotals = (value: unknown): CheckoutTotals => {
  if (!isRecord(value)) {
    throw new Error(`el cuerpo no es un objeto JSON: ${JSON.stringify(value)}`);
  }
  expectExactKeys(value, CHECKOUT_TOTALS_KEYS, [], 'CheckoutTotals');

  const { lines } = value;
  if (!isUnknownArray(lines)) {
    throw new Error(`CheckoutTotals.lines no es un arreglo JSON: ${JSON.stringify(lines)}`);
  }

  return {
    originalSubtotalCents: readInt(value.originalSubtotalCents, 'originalSubtotalCents'),
    lines: lines.map(readDiscountLine),
    // Los micros viajan a proposito, para que el desglose sea auditable (BC-R3.3).
    rawDiscountMicros: readInt(value.rawDiscountMicros, 'rawDiscountMicros'),
    rawDiscountCents: readInt(value.rawDiscountCents, 'rawDiscountCents'),
    capCents: readInt(value.capCents, 'capCents'),
    capApplied: readBoolean(value.capApplied, 'capApplied'),
    totalSavingsCents: readInt(value.totalSavingsCents, 'totalSavingsCents'),
    effectiveDiscountBps: readInt(value.effectiveDiscountBps, 'effectiveDiscountBps'),
    finalTotalCents: readInt(value.finalTotalCents, 'finalTotalCents'),
  };
};

const ORDER_ITEM_KEYS = [
  'productId',
  'name',
  'category',
  'quantity',
  'unitPriceCents',
  'lineTotalCents',
] as const;

const readOrderConfirmationItem = (value: unknown): OrderConfirmationItem => {
  if (!isRecord(value)) {
    throw new Error(`la linea de la orden no es un objeto JSON: ${JSON.stringify(value)}`);
  }
  expectExactKeys(value, ORDER_ITEM_KEYS, [], 'OrderConfirmationItem');

  const { category } = value;
  if (typeof category !== 'string' || !isProductCategory(category)) {
    throw new Error(
      `la categoria no es un literal de PRODUCT_CATEGORIES: ${JSON.stringify(category)}`,
    );
  }

  return {
    productId: readString(value.productId, 'OrderConfirmationItem.productId'),
    name: readString(value.name, 'OrderConfirmationItem.name'),
    category,
    quantity: readInt(value.quantity, 'OrderConfirmationItem.quantity'),
    unitPriceCents: readInt(value.unitPriceCents, 'OrderConfirmationItem.unitPriceCents'),
    lineTotalCents: readInt(value.lineTotalCents, 'OrderConfirmationItem.lineTotalCents'),
  };
};

const ORDER_CONFIRMATION_KEYS = ['orderId', 'createdAt', 'items', 'totals'] as const;
/** Ausente = sin cupon: el contrato no emite `couponCode: null` ni `undefined`. */
const ORDER_CONFIRMATION_OPTIONAL_KEYS = ['couponCode'] as const;

const readOrderConfirmation = (value: unknown): OrderConfirmation => {
  if (!isRecord(value)) {
    throw new Error(`el cuerpo no es un objeto JSON: ${JSON.stringify(value)}`);
  }
  expectExactKeys(
    value,
    ORDER_CONFIRMATION_KEYS,
    ORDER_CONFIRMATION_OPTIONAL_KEYS,
    'OrderConfirmation',
  );

  const { items, couponCode } = value;
  if (!isUnknownArray(items)) {
    throw new Error(`OrderConfirmation.items no es un arreglo JSON: ${JSON.stringify(items)}`);
  }
  if (couponCode !== undefined && typeof couponCode !== 'string') {
    throw new Error(`couponCode debe estar ausente o ser cadena: ${JSON.stringify(couponCode)}`);
  }

  return {
    orderId: readString(value.orderId, 'OrderConfirmation.orderId'),
    // ISO-8601, nunca el `Date` del ORM: es lo que cruza el cable (BC-R1.4).
    createdAt: readString(value.createdAt, 'OrderConfirmation.createdAt'),
    ...(couponCode === undefined ? {} : { couponCode }),
    items: items.map(readOrderConfirmationItem),
    // `CheckoutTotals` embebido y no aplanado (BC-R1.2): el mismo lector sirve para
    // `preview` y para la confirmacion, que es la prueba de que hay una sola forma.
    totals: readCheckoutTotals(value.totals),
  };
};

const isErrorCode = (value: unknown): value is ErrorCode =>
  ERROR_CODES.some((code: ErrorCode) => code === value);

/** Estrecha el cuerpo de error a la forma `ApiError` del contrato compartido. */
const readApiError = (body: unknown): ApiError['error'] => {
  if (!isRecord(body) || !isRecord(body.error)) {
    throw new Error(`el cuerpo no respeta la forma ApiError: ${JSON.stringify(body)}`);
  }
  expectExactKeys(body, ['error'], [], 'ApiError');

  const { code, message, details } = body.error;
  if (!isErrorCode(code)) {
    throw new Error(`el codigo no pertenece a ERROR_CODES: ${JSON.stringify(code)}`);
  }
  if (details !== undefined && !isRecord(details)) {
    throw new Error(`details debe estar ausente o ser un objeto: ${JSON.stringify(details)}`);
  }

  return {
    code,
    message: readString(message, 'ApiError.message'),
    ...(details === undefined ? {} : { details: { ...details } }),
  };
};

// ---------------------------------------------------------------------------
// POST /api/checkout/preview -> 200 con la forma CheckoutTotals
// (BC-R3.3, BC-R8.10)
// ---------------------------------------------------------------------------

/**
 * Fixture canonico de la politica de redondeo: 1 x `PROD-001` (129900 centavos).
 *
 * | paso         | exacto     | micros         |
 * |--------------|------------|----------------|
 * | CATEGORY 10% | 12990      | 12_990_000_000 |
 * | VOLUME 5%    | 5845.5     |  5_845_500_000 |
 * | COUPON 15%   | 16659.675  | 16_659_675_000 |
 * | total        | 35495.175  | -> 35495       |
 *
 * Un motor que redondeara paso a paso devolveria 35496, y este cuerpo lo delataria.
 */
const LAPTOP_BODY = { items: [{ productId: 'PROD-001', quantity: 1 }] } as const;
const LAPTOP_WITH_COUPON = { ...LAPTOP_BODY, couponCode: 'WELCOME2026' } as const;

describe('POST /api/checkout/preview responde 200 con CheckoutTotals (BC-R8.10)', () => {
  it('responde 200 y no 201, con JSON', async () => {
    const { server } = await startApp();

    const response = await request(server).post(PREVIEW_ROUTE).send(LAPTOP_WITH_COUPON);

    // El 200 es explicito en el controlador: el defecto de Nest para un @Post() es 201,
    // y previsualizar no crea nada (BC-R3.3).
    expect(response.status).toBe(200);
    expect(response.type).toBe('application/json');
  });

  it('emite las tres lineas del desglose en orden de precedencia', async () => {
    const { server } = await startApp();

    const response = await request(server).post(PREVIEW_ROUTE).send(LAPTOP_WITH_COUPON);
    const payload: unknown = response.body;
    const totals = readCheckoutTotals(payload);

    expect(totals.lines.map((line) => line.name)).toStrictEqual([
      'CATEGORY',
      'VOLUME',
      'COUPON',
    ]);
    expect(totals.lines.map((line) => line.applied)).toStrictEqual([true, true, true]);
    expect(totals.lines.map((line) => line.rateBps)).toStrictEqual([1000, 500, 1500]);
  });

  it('serializa los enteros de la cascada sin perder los micro-centavos', async () => {
    const { server } = await startApp();

    const response = await request(server).post(PREVIEW_ROUTE).send(LAPTOP_WITH_COUPON);
    const payload: unknown = response.body;
    const totals = readCheckoutTotals(payload);

    expect(totals).toStrictEqual({
      originalSubtotalCents: 129900,
      lines: totals.lines,
      rawDiscountMicros: 35_495_175_000,
      // Un unico redondeo, al final: 35495 y no 35496.
      rawDiscountCents: 35495,
      capCents: 45465,
      capApplied: false,
      totalSavingsCents: 35495,
      effectiveDiscountBps: 2732,
      finalTotalCents: 94405,
    });
    // Reparto por mayor resto: las lineas suman exactamente rawDiscountCents.
    expect(totals.lines.map((line) => line.discountCents)).toStrictEqual([12990, 5845, 16660]);
    expect(
      totals.lines.reduce((sum: number, line) => sum + line.discountCents, 0),
    ).toBe(totals.rawDiscountCents);
  });

  it('el carrito vacio responde 200 con ceros y sin efectos', async () => {
    const { server, purchase } = await startApp();
    const stockBefore = purchase.snapshotStock();

    const response = await request(server).post(PREVIEW_ROUTE).send({ items: [] });
    const payload: unknown = response.body;
    const totals = readCheckoutTotals(payload);

    expect(response.status).toBe(200);
    expect(totals.originalSubtotalCents).toBe(0);
    expect(totals.totalSavingsCents).toBe(0);
    expect(totals.finalTotalCents).toBe(0);
    expect(totals.lines.map((line) => line.applied)).toStrictEqual([false, false, false]);
    expect(purchase.confirmCalls).toBe(0);
    expect(purchase.snapshotStock()).toStrictEqual(stockBefore);
  });

  it('no comprueba stock ni produce efectos pidiendo mas unidades de las disponibles', async () => {
    const { server, purchase } = await startApp();
    const stockBefore = purchase.snapshotStock();

    // 10 unidades de PROD-005, que tiene stock 3: previsualizar no reserva nada.
    const response = await request(server)
      .post(PREVIEW_ROUTE)
      .send({ items: [{ productId: 'PROD-005', quantity: 10 }] });
    const payload: unknown = response.body;

    expect(response.status).toBe(200);
    expect(readCheckoutTotals(payload).originalSubtotalCents).toBe(59000);
    expect(purchase.confirmCalls).toBe(0);
    expect(purchase.orders).toStrictEqual([]);
    expect(purchase.snapshotStock()).toStrictEqual(stockBefore);
  });
});

// ---------------------------------------------------------------------------
// POST /api/checkout -> 201 con la forma OrderConfirmation
// (BC-R5.5, BC-R5.7, BC-R8.10)
// ---------------------------------------------------------------------------

describe('POST /api/checkout responde 201 con OrderConfirmation (BC-R8.10)', () => {
  it('responde 201 con el comprobante completo', async () => {
    const { server } = await startApp();

    const response = await request(server).post(CHECKOUT_ROUTE).send(LAPTOP_BODY);
    const payload: unknown = response.body;
    const confirmation = readOrderConfirmation(payload);

    // 201 por defecto de Nest, que aqui si es el correcto: la orden se acaba de crear.
    expect(response.status).toBe(201);
    expect(response.type).toBe('application/json');
    expect(confirmation.orderId).toBe('ORD-001');
    expect(confirmation.createdAt).toBe(FIXED_CREATED_AT.toISOString());
    expect(confirmation.items).toStrictEqual([
      {
        productId: 'PROD-001',
        name: 'Laptop Pro 14"',
        category: 'Tecnologia',
        quantity: 1,
        unitPriceCents: 129900,
        lineTotalCents: 129900,
      },
    ]);
    // Sin cupon la propiedad esta AUSENTE: ni `null` ni `undefined` en el JSON.
    expect('couponCode' in confirmation).toBe(false);
    expect(response.text).not.toContain('couponCode');
  });

  it('embebe los totales recalculados por el motor', async () => {
    const { server } = await startApp();

    const response = await request(server).post(CHECKOUT_ROUTE).send(LAPTOP_BODY);
    const payload: unknown = response.body;
    const { totals } = readOrderConfirmation(payload);

    // 12990 + 5845.5 = 18835.5 -> un unico redondeo half-up: 18836.
    expect(totals).toStrictEqual({
      originalSubtotalCents: 129900,
      lines: totals.lines,
      rawDiscountMicros: 18_835_500_000,
      rawDiscountCents: 18836,
      capCents: 45465,
      capApplied: false,
      totalSavingsCents: 18836,
      effectiveDiscountBps: 1450,
      finalTotalCents: 111064,
    });
    expect(totals.lines.map((line) => line.discountCents)).toStrictEqual([12990, 5846, 0]);
  });

  it('persiste la orden y decrementa el stock (BC-R5.7)', async () => {
    const { server, purchase } = await startApp();

    const response = await request(server).post(CHECKOUT_ROUTE).send(LAPTOP_WITH_COUPON);
    const payload: unknown = response.body;
    const confirmation = readOrderConfirmation(payload);

    expect(response.status).toBe(201);
    expect(confirmation.couponCode).toBe('WELCOME2026');
    expect(purchase.confirmCalls).toBe(1);
    // El decremento se afirma sobre el almacen del puerto y no con GET /api/products:
    // ese endpoint pertenece a `ProductsModule`, y aqui el catalogo lo sirve un doble
    // independiente del puerto. Su visibilidad HTTP y su supervivencia al reinicio son
    // garantia estructural y se verifican en la demostracion en vivo (BC-R5.7).
    expect(purchase.stockOf('PROD-001')).toBe(4);
    expect(purchase.decrements).toStrictEqual([
      { productId: 'PROD-001', quantity: 1, stockBefore: 5, stockAfter: 4 },
    ]);
    expect(purchase.orders).toHaveLength(1);
    expect(purchase.orders.map((order) => order.totalSavingsCents)).toStrictEqual([35495]);
    expect(purchase.orders.map((order) => order.couponCode)).toStrictEqual(['WELCOME2026']);
  });

  it('devuelve por HTTP los mismos totales que preview para el mismo cuerpo (BC-R5.2)', async () => {
    const { server } = await startApp();

    const previewResponse = await request(server).post(PREVIEW_ROUTE).send(LAPTOP_WITH_COUPON);
    const checkoutResponse = await request(server).post(CHECKOUT_ROUTE).send(LAPTOP_WITH_COUPON);

    const previewPayload: unknown = previewResponse.body;
    const checkoutPayload: unknown = checkoutResponse.body;

    // Un solo motor y una sola politica de redondeo: la igualdad es estructural, no
    // una coincidencia que haya que mantener.
    expect(readOrderConfirmation(checkoutPayload).totals).toStrictEqual(
      readCheckoutTotals(previewPayload),
    );
  });
});

// ---------------------------------------------------------------------------
// Cuerpo invalido -> 400 sin llegar al servicio (BC-R2.3)
// ---------------------------------------------------------------------------

interface InvalidBodyCase {
  readonly scenario: string;
  readonly body: Readonly<Record<string, unknown>>;
}

const INVALID_BODY_CASES: readonly InvalidBodyCase[] = [
  {
    // `forbidNonWhitelisted`: el cliente no puede colar un monto ni por accidente.
    scenario: 'propiedad ajena de monto',
    body: { items: [{ productId: 'PROD-001', quantity: 1 }], totalSavingsCents: 999999 },
  },
  {
    scenario: 'propiedad ajena en la linea del carrito',
    body: { items: [{ productId: 'PROD-001', quantity: 1, unitPriceCents: 1 }] },
  },
  { scenario: 'items ausente', body: { couponCode: 'WELCOME2026' } },
  { scenario: 'items que no es arreglo', body: { items: 'PROD-001' } },
  { scenario: 'items nulo', body: { items: null } },
  {
    // La nidificacion se valida de verdad: sin `@Type` estas reglas no correrian.
    scenario: 'cantidad cero en una linea',
    body: { items: [{ productId: 'PROD-001', quantity: 0 }] },
  },
  {
    scenario: 'cantidad fraccionaria en una linea',
    body: { items: [{ productId: 'PROD-001', quantity: 1.5 }] },
  },
  {
    scenario: 'productId vacio',
    body: { items: [{ productId: '', quantity: 1 }] },
  },
  {
    scenario: 'couponCode que no es texto',
    body: { items: [{ productId: 'PROD-001', quantity: 1 }], couponCode: 42 },
  },
];

describe.each([PREVIEW_ROUTE, CHECKOUT_ROUTE])(
  'POST %s con un cuerpo invalido responde 400 sin llegar al servicio (BC-R2.3)',
  (route: string) => {
    it.each([...INVALID_BODY_CASES])('$scenario', async ({ body }: InvalidBodyCase) => {
      const { server, products, purchase } = await startApp();
      const stockBefore = purchase.snapshotStock();

      const response = await request(server).post(route).send(body);

      expect(response.status).toBe(400);
      // No llego al servicio: si hubiera llegado, habria leido el catalogo. Es la unica
      // forma de distinguir el 400 del pipe del 400 de dominio sin espiar el servicio.
      expect(products.findAllCalls).toBe(0);
      expect(purchase.confirmCalls).toBe(0);
      expect(purchase.orders).toStrictEqual([]);
      expect(purchase.snapshotStock()).toStrictEqual(stockBefore);
    });
  },
);

// ---------------------------------------------------------------------------
// Errores de dominio -> ApiError con el estado de la tabla del filtro (BC-R7.1)
// ---------------------------------------------------------------------------

describe('POST /api/checkout con stock insuficiente responde 409 (BC-R4.3, BC-R7.1)', () => {
  it('emite ApiError con TODAS las lineas deficitarias, ordenadas', async () => {
    const { server, purchase } = await startApp();
    const stockBefore = purchase.snapshotStock();

    // PROD-001 tiene stock 5 y PROD-005 stock 3: las dos lineas son deficitarias, y
    // entran desordenadas para que el orden de la respuesta sea del backend.
    const response = await request(server)
      .post(CHECKOUT_ROUTE)
      .send({
        items: [
          { productId: 'PROD-005', quantity: 4 },
          { productId: 'PROD-001', quantity: 6 },
        ],
      });
    const payload: unknown = response.body;

    expect(response.status).toBe(409);
    expect(response.type).toBe('application/json');
    expect(readApiError(payload)).toStrictEqual({
      code: 'INSUFFICIENT_STOCK',
      message: 'Alguna linea del carrito supera el stock disponible.',
      details: {
        shortages: [
          { productId: 'PROD-001', requested: 6, available: 5 },
          { productId: 'PROD-005', requested: 4, available: 3 },
        ],
      },
    });
    // Rechazado sin escribir: el puerto no llego a invocarse (BC-R4.4).
    expect(purchase.confirmCalls).toBe(0);
    expect(purchase.orders).toStrictEqual([]);
    expect(purchase.snapshotStock()).toStrictEqual(stockBefore);
  });

  it('la cantidad igual al stock disponible no es deficit y responde 201', async () => {
    const { server, purchase } = await startApp();

    // Frontera de PROD-005: 3 unidades sobre un stock de 3 se satisfacen.
    const response = await request(server)
      .post(CHECKOUT_ROUTE)
      .send({ items: [{ productId: 'PROD-005', quantity: 3 }] });

    expect(response.status).toBe(201);
    expect(purchase.stockOf('PROD-005')).toBe(0);
  });
});

describe('POST /api/checkout con un carrito vacio responde 400 INVALID_CART (BC-R7.1)', () => {
  it('el 400 lo emite el dominio, con la forma ApiError, y no persiste nada', async () => {
    const { server, purchase } = await startApp();
    const stockBefore = purchase.snapshotStock();

    const response = await request(server).post(CHECKOUT_ROUTE).send({ items: [] });
    const payload: unknown = response.body;

    expect(response.status).toBe(400);
    // Comparte estado con el 400 del `ValidationPipe` pero no cuerpo: este respeta
    // `ApiError` porque lo produjo el `ApiExceptionFilter` desde un error tipado.
    expect(readApiError(payload)).toStrictEqual({
      code: 'INVALID_CART',
      message: 'No se puede confirmar una compra sin productos.',
    });
    expect(purchase.confirmCalls).toBe(0);
    expect(purchase.orders).toStrictEqual([]);
    expect(purchase.snapshotStock()).toStrictEqual(stockBefore);
  });
});

describe('POST /api/checkout con un producto inexistente responde 404 (BC-R7.1)', () => {
  it('la validez del carrito se evalua antes del stock, asi que no es un 409', async () => {
    const { server, purchase } = await startApp();

    const response = await request(server)
      .post(CHECKOUT_ROUTE)
      .send({
        items: [
          { productId: 'PROD-005', quantity: 4 },
          { productId: 'PROD-999', quantity: 1 },
        ],
      });
    const payload: unknown = response.body;

    expect(response.status).toBe(404);
    expect(readApiError(payload)).toStrictEqual({
      code: 'PRODUCT_NOT_FOUND',
      message: 'El producto PROD-999 no existe en el catalogo.',
      details: { lineIndex: 1, productId: 'PROD-999' },
    });
    expect(purchase.confirmCalls).toBe(0);
  });
});
