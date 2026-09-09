import { CATALOG_PRODUCTS, DiscountDomainError, isDiscountDomainError } from '@core/shared';

import { InMemoryProductRepository } from '../../test/doubles/in-memory-product.repository';
import {
  FIXED_CREATED_AT,
  InMemoryPurchasePort,
} from '../../test/doubles/in-memory-purchase.port';
import { CheckoutService } from './checkout.service';

import type {
  CartItem,
  CheckoutRequest,
  CheckoutTotals,
  DiscountLine,
  DiscountName,
  ErrorCode,
  Product,
} from '@core/shared';

import type { NewOrder, PersistedOrder } from '../domain/order.repository';
import type { PurchaseConfirmationPort } from '../domain/purchase.port';

/**
 * Pruebas por ejemplo de `CheckoutService`, con los dobles tipados del
 * `ProductRepository` y del `PurchaseConfirmationPort`. Sin base de datos, sin
 * contenedor de Nest y sin generadores: cada monto esperado es un entero verificable
 * a mano contra el catalogo canonico.
 *
 * El servicio se instancia con `new`, igual que en `catalog.service.spec.ts`: la
 * inyeccion por token la resuelve `CheckoutModule`, y ejercitarla aqui verificaria el
 * contenedor en vez del caso de uso.
 *
 * Cubre:
 * - rechazo por stock con TODAS las lineas deficitarias y sin efecto alguno (BC-R8.2),
 * - la frontera de `PROD-005` con stock `3` (BC-R8.3),
 * - `preview` sin efectos ni pidiendo mas unidades de las disponibles (BC-R8.4),
 * - igualdad campo por campo de los totales entre `preview` y `confirm` (BC-R8.5),
 * - carrito vacio en ambos caminos (BC-R8.6),
 * - carrito corrupto: producto inexistente y cantidad no positiva (BC-R8.7),
 * - los cuatro casos de cupon, incluido el tope de `DEMOCAP50` persistido (BC-R8.8),
 * - la guarda del compare-and-swap, un solo escenario (BC-R8.9).
 *
 * Requisitos: BC-R8.2 a BC-R8.9.
 */

// --- Fixtures y utilidades -------------------------------------------------------

const item = (productId: string, quantity: number): CartItem => ({ productId, quantity });

/** El spread condicional lo exige `exactOptionalPropertyTypes`: sin cupon = AUSENTE. */
const request = (items: readonly CartItem[], couponCode?: string): CheckoutRequest => ({
  items,
  ...(couponCode === undefined ? {} : { couponCode }),
});

interface HarnessOptions {
  readonly catalog?: readonly Product[];
  /** Productos cuyo decremento condicional se reporta sin filas afectadas. */
  readonly contendedProductIds?: readonly string[];
}

interface Harness {
  readonly service: CheckoutService;
  readonly products: InMemoryProductRepository;
  readonly purchase: InMemoryPurchasePort;
}

/**
 * Los dos dobles comparten el MISMO catalogo: el repositorio entrega los precios y el
 * stock que el caso de uso lee, y el puerto arranca con ese stock. Si cada uno tomara
 * el suyo, una prueba de frontera podria pasar por descuido.
 */
const harness = (options: HarnessOptions = {}): Harness => {
  const catalog = options.catalog ?? CATALOG_PRODUCTS;
  const products = new InMemoryProductRepository(catalog);
  const purchase = new InMemoryPurchasePort({
    catalog,
    ...(options.contendedProductIds === undefined
      ? {}
      : { contendedProductIds: options.contendedProductIds }),
  });

  return { service: new CheckoutService(products, purchase), products, purchase };
};

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

/**
 * Afirma la ausencia de efectos: ni decrementos, ni orden, ni stock movido.
 * `stockBefore` se captura antes de la llamada, asi que la comparacion no depende de
 * que el catalogo del harness sea el canonico.
 */
const expectNoEffects = (
  purchase: InMemoryPurchasePort,
  stockBefore: Readonly<Record<string, number>>,
): void => {
  expect(purchase.decrements).toStrictEqual([]);
  expect(purchase.orders).toStrictEqual([]);
  expect(purchase.snapshotStock()).toStrictEqual(stockBefore);
};

/** Linea del desglose por nombre, sin indexar bajo `noUncheckedIndexedAccess`. */
const lineOf = (totals: CheckoutTotals, name: DiscountName): DiscountLine => {
  const line = totals.lines.find((candidate) => candidate.name === name);
  if (line === undefined) {
    throw new Error(`el desglose no incluye la linea ${name}: revisa el factory`);
  }
  return line;
};

// --- BC-R8.2: rechazo por stock insuficiente --------------------------------------

describe('confirm: rechazo por stock insuficiente (BC-R8.2)', () => {
  it('reporta TODAS las lineas deficitarias, ordenadas, y no escribe nada', async () => {
    const { service, purchase } = harness();
    const stockBefore = purchase.snapshotStock();

    // PROD-005 tiene stock 3 y PROD-001 stock 5: las dos lineas son deficitarias.
    const error = await rejectedDomainError(() =>
      service.confirm(request([item('PROD-005', 4), item('PROD-001', 6)])),
    );

    expect(error).toBeInstanceOf(DiscountDomainError);
    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.details).toStrictEqual({
      shortages: [
        { productId: 'PROD-001', requested: 6, available: 5 },
        { productId: 'PROD-005', requested: 4, available: 3 },
      ],
    });
    // El puerto no llego a invocarse: el rechazo es por construccion, no por rollback.
    expect(purchase.confirmCalls).toBe(0);
    expectNoEffects(purchase, stockBefore);
  });

  it('evalua dos lineas del mismo producto por su suma', async () => {
    const { service, purchase } = harness();
    const stockBefore = purchase.snapshotStock();

    // 2 + 2 = 4 sobre un stock de 3. Evaluadas por separado, ambas pasarian.
    const error = await rejectedDomainError(() =>
      service.confirm(request([item('PROD-005', 2), item('PROD-005', 2)])),
    );

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.details).toStrictEqual({
      shortages: [{ productId: 'PROD-005', requested: 4, available: 3 }],
    });
    expect(purchase.confirmCalls).toBe(0);
    expectNoEffects(purchase, stockBefore);
  });

  it('el mensaje describe el deficit y no filtra detalles de infraestructura', async () => {
    const { service } = harness();

    const error = await rejectedDomainError(() =>
      service.confirm(request([item('PROD-005', 9)])),
    );

    expect(error.message).toBe('Alguna linea del carrito supera el stock disponible.');
  });
});

// --- BC-R8.3: frontera del stock de PROD-005 --------------------------------------

describe('confirm: frontera del stock con PROD-005 (BC-R8.3)', () => {
  it('la cantidad igual al disponible continua y decrementa hasta cero', async () => {
    const { service, purchase } = harness();

    const confirmation = await service.confirm(request([item('PROD-005', 3)]));

    expect(purchase.decrements).toStrictEqual([
      { productId: 'PROD-005', quantity: 3, stockBefore: 3, stockAfter: 0 },
    ]);
    expect(purchase.stockOf('PROD-005')).toBe(0);
    expect(purchase.orders).toHaveLength(1);

    expect(confirmation.orderId).toBe('ORD-001');
    expect(confirmation.createdAt).toBe(FIXED_CREATED_AT.toISOString());
    // Sin cupon, la propiedad esta AUSENTE y no presente con valor undefined.
    expect('couponCode' in confirmation).toBe(false);
    expect(confirmation.items).toStrictEqual([
      {
        productId: 'PROD-005',
        name: 'Juego de Sábanas',
        category: 'Hogar',
        quantity: 3,
        unitPriceCents: 5900,
        lineTotalCents: 17700,
      },
    ]);
    // 17700 sin Tecnologia: CATEGORY no aplica, VOLUME si (17700 > 10000): 5% = 885.
    expect(confirmation.totals.originalSubtotalCents).toBe(17700);
    expect(confirmation.totals.totalSavingsCents).toBe(885);
    expect(confirmation.totals.finalTotalCents).toBe(16815);
  });

  it('una unidad mas rechaza sin tocar el almacen', async () => {
    const { service, purchase } = harness();
    const stockBefore = purchase.snapshotStock();

    const error = await rejectedDomainError(() =>
      service.confirm(request([item('PROD-005', 4)])),
    );

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.details).toStrictEqual({
      shortages: [{ productId: 'PROD-005', requested: 4, available: 3 }],
    });
    expect(purchase.stockOf('PROD-005')).toBe(3);
    expectNoEffects(purchase, stockBefore);
  });
});

// --- BC-R8.6: carrito vacio -------------------------------------------------------

describe('carrito vacio (BC-R8.6)', () => {
  it('preview devuelve ahorro cero sin lanzar, con las tres lineas no aplicadas', async () => {
    const { service } = harness();

    const totals = await service.preview(request([]));

    expect(totals.originalSubtotalCents).toBe(0);
    expect(totals.rawDiscountMicros).toBe(0);
    expect(totals.rawDiscountCents).toBe(0);
    expect(totals.capCents).toBe(0);
    expect(totals.capApplied).toBe(false);
    expect(totals.totalSavingsCents).toBe(0);
    expect(totals.effectiveDiscountBps).toBe(0);
    expect(totals.finalTotalCents).toBe(0);
    expect(totals.lines.map((line) => line.name)).toStrictEqual([
      'CATEGORY',
      'VOLUME',
      'COUPON',
    ]);
    expect(totals.lines.map((line) => line.applied)).toStrictEqual([false, false, false]);
  });

  it('preview con carrito vacio tampoco produce efectos', async () => {
    const { service, purchase } = harness();
    const stockBefore = purchase.snapshotStock();

    await service.preview(request([]));

    expect(purchase.confirmCalls).toBe(0);
    expectNoEffects(purchase, stockBefore);
  });

  it('confirm falla con INVALID_CART sin leer el catalogo ni persistir', async () => {
    const { service, products, purchase } = harness();
    const stockBefore = purchase.snapshotStock();

    const error = await rejectedDomainError(() => service.confirm(request([])));

    expect(error.code).toBe('INVALID_CART');
    expect(error.message).toBe('No se puede confirmar una compra sin productos.');
    expect(error.details).toBeUndefined();
    // La guarda del carrito vacio precede a la lectura del catalogo (paso 1 antes del 2).
    expect(products.findAllCalls).toBe(0);
    expect(purchase.confirmCalls).toBe(0);
    expectNoEffects(purchase, stockBefore);
  });
});

// --- BC-R8.7: carrito con datos corruptos -----------------------------------------

interface CorruptCartCase {
  readonly scenario: string;
  readonly items: readonly CartItem[];
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
}

const CORRUPT_CART_CASES: readonly CorruptCartCase[] = [
  {
    scenario: 'producto inexistente da PRODUCT_NOT_FOUND',
    items: [item('PROD-999', 1)],
    code: 'PRODUCT_NOT_FOUND',
    details: { lineIndex: 0, productId: 'PROD-999' },
  },
  {
    scenario: 'cantidad cero da INVALID_CART',
    items: [item('PROD-001', 0)],
    code: 'INVALID_CART',
    details: { lineIndex: 0, productId: 'PROD-001', quantity: 0 },
  },
  {
    scenario: 'cantidad negativa da INVALID_CART',
    items: [item('PROD-001', -2)],
    code: 'INVALID_CART',
    details: { lineIndex: 0, productId: 'PROD-001', quantity: -2 },
  },
  {
    scenario: 'cantidad fraccionaria da INVALID_CART',
    items: [item('PROD-006', 1.5)],
    code: 'INVALID_CART',
    details: { lineIndex: 0, productId: 'PROD-006', quantity: 1.5 },
  },
  {
    // Invariante I4: la validez del carrito se evalua ANTES del stock, asi que la
    // linea deficitaria de PROD-005 no convierte este caso en un 409.
    scenario: 'producto inexistente junto a una linea deficitaria sigue siendo 404',
    items: [item('PROD-005', 4), item('PROD-999', 1)],
    code: 'PRODUCT_NOT_FOUND',
    details: { lineIndex: 1, productId: 'PROD-999' },
  },
];

describe('confirm: carrito con datos corruptos (BC-R8.7)', () => {
  it.each([...CORRUPT_CART_CASES])(
    '$scenario',
    async ({ items, code, details }: CorruptCartCase) => {
      const { service, purchase } = harness();
      const stockBefore = purchase.snapshotStock();

      const error = await rejectedDomainError(() => service.confirm(request(items)));

      expect(error.code).toBe(code);
      expect(error.details).toStrictEqual(details);
      expect(purchase.confirmCalls).toBe(0);
      expectNoEffects(purchase, stockBefore);
    },
  );

  it.each([...CORRUPT_CART_CASES])(
    'preview emite el mismo error tipado: $scenario',
    async ({ items, code }: CorruptCartCase) => {
      const { service } = harness();

      const error = await rejectedDomainError(() => service.preview(request(items)));

      expect(error.code).toBe(code);
    },
  );
});

// --- BC-R8.8: cupones --------------------------------------------------------------

/**
 * Fixture canonico de la politica de redondeo: 1 x PROD-001 (129900) con WELCOME2026.
 *
 * | paso              | exacto        | micros         |
 * |-------------------|---------------|----------------|
 * | CATEGORY 10%      | 12990         | 12_990_000_000 |
 * | VOLUME 5%         | 5845.5        |  5_845_500_000 |
 * | COUPON 15%        | 16659.675     | 16_659_675_000 |
 * | descuento total   | 35495.175     | -> 35495       |
 *
 * Un motor que redondeara paso a paso devolveria 35496.
 */
const LAPTOP_CART: readonly CartItem[] = [item('PROD-001', 1)];

describe('cupones: WELCOME2026 en su orden de precedencia (BC-R8.8)', () => {
  it('aplica 15% sobre el remanente que dejo VOLUME, no sobre el subtotal', async () => {
    const { service } = harness();

    const totals = await service.preview(request(LAPTOP_CART, 'WELCOME2026'));

    expect(totals.lines.map((line) => line.name)).toStrictEqual([
      'CATEGORY',
      'VOLUME',
      'COUPON',
    ]);

    const category = lineOf(totals, 'CATEGORY');
    const volume = lineOf(totals, 'VOLUME');
    const coupon = lineOf(totals, 'COUPON');

    expect(category).toMatchObject({
      applied: true,
      rateBps: 1000,
      baseAmountMicros: 129_900_000_000,
      discountMicros: 12_990_000_000,
    });
    expect(volume).toMatchObject({
      applied: true,
      rateBps: 500,
      baseAmountMicros: 116_910_000_000,
      discountMicros: 5_845_500_000,
    });
    // La base del cupon ES la prueba de la precedencia: 129900 - 12990 - 5845.5.
    expect(coupon).toMatchObject({
      applied: true,
      rateBps: 1500,
      baseAmountMicros: 111_064_500_000,
      discountMicros: 16_659_675_000,
    });
  });

  it('redondea una sola vez al final: 35495 y no 35496', async () => {
    const { service } = harness();

    const totals = await service.preview(request(LAPTOP_CART, 'WELCOME2026'));

    expect(totals.rawDiscountMicros).toBe(35_495_175_000);
    expect(totals.rawDiscountCents).toBe(35495);
    expect(totals.totalSavingsCents).toBe(35495);
    expect(totals.capCents).toBe(45465);
    expect(totals.capApplied).toBe(false);
    expect(totals.finalTotalCents).toBe(94405);
    // Reparto por mayor resto: el centavo sobrante va a la linea de mayor fraccion.
    expect(totals.lines.map((line) => line.discountCents)).toStrictEqual([
      12990, 5845, 16660,
    ]);
  });

  it('confirm persiste el codigo presentado y los montos del motor', async () => {
    const { service, purchase } = harness();

    const confirmation = await service.confirm(request(LAPTOP_CART, 'WELCOME2026'));

    expect(confirmation.couponCode).toBe('WELCOME2026');
    expect(purchase.orders.map((order) => order.couponCode)).toStrictEqual(['WELCOME2026']);
    expect(purchase.orders.map((order) => order.totalSavingsCents)).toStrictEqual([35495]);
    expect(purchase.orders.map((order) => order.finalTotalCents)).toStrictEqual([94405]);
    expect(purchase.orders.map((order) => order.capApplied)).toStrictEqual([false]);
  });
});

describe('cupones: expirado y no registrado se ignoran (BC-R8.8)', () => {
  const IGNORED_CODES: readonly string[] = ['SUMMER2024', 'NOPE9999', ''];

  it.each([...IGNORED_CODES])(
    'el codigo "%s" deja la linea COUPON no aplicada y la cascada intacta',
    async (couponCode: string) => {
      const { service } = harness();

      const withCoupon = await service.preview(request(LAPTOP_CART, couponCode));
      const withoutCoupon = await service.preview(request(LAPTOP_CART));

      // Ignorado no es error, y tampoco altera lo que aportaron CATEGORY y VOLUME:
      // los totales son identicos a los del mismo carrito sin cupon.
      expect(withCoupon).toStrictEqual(withoutCoupon);

      expect(lineOf(withCoupon, 'COUPON')).toMatchObject({
        applied: false,
        rateBps: 0,
        baseAmountMicros: 0,
        discountMicros: 0,
        discountCents: 0,
      });
      // 12990 + 5845.5 = 18835.5 -> un unico redondeo half-up: 18836.
      expect(withCoupon.rawDiscountMicros).toBe(18_835_500_000);
      expect(withCoupon.rawDiscountCents).toBe(18836);
      expect(withCoupon.totalSavingsCents).toBe(18836);
      expect(withCoupon.finalTotalCents).toBe(111064);
      expect(withCoupon.capApplied).toBe(false);
    },
  );

  it('confirm con un cupon expirado completa la compra y persiste el codigo', async () => {
    const { service, purchase } = harness();

    const confirmation = await service.confirm(request(LAPTOP_CART, 'SUMMER2024'));

    // El codigo se persiste tal cual; que fue ignorado lo dice el desglose embebido.
    expect(confirmation.couponCode).toBe('SUMMER2024');
    expect(lineOf(confirmation.totals, 'COUPON').applied).toBe(false);
    expect(confirmation.totals.totalSavingsCents).toBe(18836);
    expect(purchase.orders.map((order) => order.couponCode)).toStrictEqual(['SUMMER2024']);
    expect(purchase.decrements).toStrictEqual([
      { productId: 'PROD-001', quantity: 1, stockBefore: 5, stockAfter: 4 },
    ]);
  });
});

describe('cupones: DEMOCAP50 activa el tope y queda persistido (BC-R8.8)', () => {
  it('trunca el descuento en el 35% y marca capApplied en los totales', async () => {
    const { service } = harness();

    const totals = await service.preview(request(LAPTOP_CART, 'DEMOCAP50'));

    // 12990 + 5845.5 + 55532.25 = 74367.75 -> 74368, por encima del tope de 45465.
    expect(lineOf(totals, 'COUPON')).toMatchObject({ applied: true, rateBps: 5000 });
    expect(totals.rawDiscountMicros).toBe(74_367_750_000);
    expect(totals.rawDiscountCents).toBe(74368);
    expect(totals.capCents).toBe(45465);
    expect(totals.capApplied).toBe(true);
    expect(totals.totalSavingsCents).toBe(45465);
    expect(totals.finalTotalCents).toBe(84435);
    expect(totals.effectiveDiscountBps).toBe(3500);
  });

  it('confirm persiste el indicador de tope y el ahorro ya topado', async () => {
    const { service, purchase } = harness();

    const confirmation = await service.confirm(request(LAPTOP_CART, 'DEMOCAP50'));

    expect(confirmation.totals.capApplied).toBe(true);
    expect(purchase.orders.map((order) => order.capApplied)).toStrictEqual([true]);
    expect(purchase.orders.map((order) => order.totalSavingsCents)).toStrictEqual([45465]);
    expect(purchase.orders.map((order) => order.finalTotalCents)).toStrictEqual([84435]);
    expect(purchase.orders.map((order) => order.couponCode)).toStrictEqual(['DEMOCAP50']);
  });
});

// --- BC-R8.4: preview no tiene efectos --------------------------------------------

describe('preview: sin efectos observables (BC-R8.4)', () => {
  it('calcula el desglose pidiendo mas unidades de las disponibles', async () => {
    const { service, purchase } = harness();
    const stockBefore = purchase.snapshotStock();

    // 10 unidades de PROD-005, que tiene stock 3: previsualizar no comprueba stock.
    const totals = await service.preview(request([item('PROD-005', 10)]));

    expect(totals.originalSubtotalCents).toBe(59000);
    expect(totals.totalSavingsCents).toBe(2950);
    expect(purchase.confirmCalls).toBe(0);
    expect(purchase.stockOf('PROD-005')).toBe(3);
    expectNoEffects(purchase, stockBefore);
  });

  it('tres previsualizaciones seguidas no crean ninguna orden', async () => {
    const { service, purchase } = harness();
    const stockBefore = purchase.snapshotStock();

    await service.preview(request([item('PROD-001', 9)], 'WELCOME2026'));
    await service.preview(request([item('PROD-005', 4)]));
    await service.preview(request([item('PROD-006', 100)], 'DEMOCAP50'));

    expect(purchase.confirmCalls).toBe(0);
    expectNoEffects(purchase, stockBefore);
  });

  it('lee el catalogo del repositorio una vez por invocacion', async () => {
    const { service, products } = harness();

    await service.preview(request(LAPTOP_CART));
    await service.preview(request(LAPTOP_CART));

    expect(products.findAllCalls).toBe(2);
  });
});

// --- BC-R8.5: igualdad preview / confirm ------------------------------------------

const TOTALS_FIELDS = [
  'originalSubtotalCents',
  'rawDiscountMicros',
  'rawDiscountCents',
  'capCents',
  'capApplied',
  'totalSavingsCents',
  'effectiveDiscountBps',
  'finalTotalCents',
] as const satisfies readonly (keyof CheckoutTotals)[];

/** Mismo carrito mixto y mismo cupon por los dos caminos, en un harness limpio. */
const CONSISTENCY_CART: readonly CartItem[] = [
  item('PROD-001', 1),
  item('PROD-004', 2),
  item('PROD-006', 3),
];

const bothPaths = async (): Promise<{
  readonly preview: CheckoutTotals;
  readonly confirmed: CheckoutTotals;
}> => {
  const { service } = harness();
  const payload = request(CONSISTENCY_CART, 'WELCOME2026');

  const preview = await service.preview(payload);
  const confirmation = await service.confirm(payload);

  return { preview, confirmed: confirmation.totals };
};

describe('preview y confirm producen los mismos montos (BC-R8.5)', () => {
  it.each([...TOTALS_FIELDS])(
    'el campo %s coincide en ambos caminos',
    async (field: (typeof TOTALS_FIELDS)[number]) => {
      const { preview, confirmed } = await bothPaths();

      expect(confirmed[field]).toBe(preview[field]);
    },
  );

  it('el desglose completo es identico linea por linea', async () => {
    const { preview, confirmed } = await bothPaths();

    expect(confirmed.lines).toStrictEqual(preview.lines);
  });

  it('el objeto de totales entero es identico', async () => {
    const { preview, confirmed } = await bothPaths();

    // Un solo motor y una sola politica de redondeo: la igualdad es estructural.
    expect(confirmed).toStrictEqual(preview);
  });
});

// --- Orden persistida: lineas normalizadas y deterministas ------------------------

describe('confirm: lineas de la orden (BC-R5.2)', () => {
  it('emite una linea por producto distinto, ascendente por productId', async () => {
    const { service, purchase } = harness();

    // Entra desordenado y con PROD-001 repetido: 2 + 1 = 3 unidades, stock 5.
    const confirmation = await service.confirm(
      request([item('PROD-006', 2), item('PROD-001', 2), item('PROD-001', 1)]),
    );

    expect(confirmation.items).toStrictEqual([
      {
        productId: 'PROD-001',
        name: 'Laptop Pro 14"',
        category: 'Tecnologia',
        quantity: 3,
        unitPriceCents: 129900,
        lineTotalCents: 389700,
      },
      {
        productId: 'PROD-006',
        name: 'Camiseta Básica',
        category: 'Ropa',
        quantity: 2,
        unitPriceCents: 1990,
        lineTotalCents: 3980,
      },
    ]);
    expect(purchase.decrements).toStrictEqual([
      { productId: 'PROD-001', quantity: 3, stockBefore: 5, stockAfter: 2 },
      { productId: 'PROD-006', quantity: 2, stockBefore: 20, stockAfter: 18 },
    ]);
    // 389700 + 3980 = 393680, y el subtotal del motor sale del mismo catalogo.
    expect(confirmation.totals.originalSubtotalCents).toBe(393680);
  });
});

// --- Guarda de frontera del mapeo de la confirmacion -------------------------------

/**
 * Puerto que devuelve una orden con una linea ajena al catalogo leido. No es un caso de
 * negocio: emula una inconsistencia de infraestructura, que es lo unico capaz de
 * producirla. Sin este doble la guarda de `toOrderConfirmation` seria codigo inalcanzable.
 */
class ForeignLinePurchasePort implements PurchaseConfirmationPort {
  confirm(order: NewOrder): Promise<PersistedOrder> {
    return Promise.resolve({
      ...order,
      id: 'ORD-999',
      createdAt: FIXED_CREATED_AT,
      lines: [
        ...order.lines,
        {
          productId: 'PROD-FANTASMA',
          category: 'Hogar',
          quantity: 1,
          unitPriceCents: 100,
          lineTotalCents: 100,
        },
      ],
    });
  }
}

describe('confirm: orden persistida inconsistente con el catalogo', () => {
  it('falla con INTERNAL_ERROR en vez de inventar el nombre del producto', async () => {
    const service = new CheckoutService(
      new InMemoryProductRepository(),
      new ForeignLinePurchasePort(),
    );

    const error = await rejectedDomainError(() =>
      service.confirm(request([item('PROD-001', 1)])),
    );

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.details).toStrictEqual({ productId: 'PROD-FANTASMA' });
  });
});

// --- BC-R8.9: guarda del compare-and-swap -----------------------------------------

describe('confirm: guarda del compare-and-swap (BC-R8.9)', () => {
  it('una actualizacion sin filas afectadas aborta la unidad completa', async () => {
    // El stock alcanza para las dos lineas, asi que la validacion previa pasa: el
    // rechazo solo puede venir de la guarda del decremento condicional.
    const { service, purchase } = harness({ contendedProductIds: ['PROD-001'] });
    const stockBefore = purchase.snapshotStock();

    const error = await rejectedDomainError(() =>
      service.confirm(request([item('PROD-001', 1), item('PROD-006', 2)])),
    );

    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.message).toBe('El stock cambio mientras se confirmaba la compra.');
    // Detalles distintos a los del deficit: el CAS no conoce el stock restante.
    expect(error.details).toStrictEqual({ contendedProductIds: ['PROD-001'] });
    // Se llamo al puerto y NO escribio: es lo que distingue esta guarda del rechazo
    // previo por stock, donde `confirmCalls` es 0.
    expect(purchase.confirmCalls).toBe(1);
    expectNoEffects(purchase, stockBefore);
  });
});
