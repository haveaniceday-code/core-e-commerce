# Design Document

## Overview

`apps/backend` gana los dos endpoints de checkout sobre las capas que ya existen —`http` →
`application` → `domain` → `infra`—. No hay estructura nueva: hay un caso de uso nuevo
(`CheckoutService`), dos funciones puras de dominio (agregación de stock y verificación del
decremento), un puerto nuevo (`PurchaseConfirmationPort`) con su adaptador Prisma, y un contrato
nuevo en `@core/shared` (`OrderConfirmation`).

El principio que gobierna el diseño es el mismo de `backend-persistence`, aplicado a un caso con
efectos: **el backend es la única fuente de verdad del cálculo y el dominio no conoce Prisma**. El
cliente envía qué quiere comprar y con qué cupón; nunca montos. `preview` y `checkout` invocan
exactamente el mismo `DiscountEngine`, y esa es la razón estructural —no la convención— por la que
los dos endpoints no pueden divergir en un centavo.

Lenguaje: TypeScript con `strict: true`, `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`.
Cero `any`, cero assertions salvo `as const` y `satisfies`. Todas las pruebas son **por ejemplo**,
con tablas de casos fijos.

### Decisiones de alcance ya cerradas

| # | Decisión |
|---|----------|
| D1 | `POST /api/checkout` devuelve `OrderConfirmation`, contrato propio que **embebe** `CheckoutTotals`. `preview` devuelve `CheckoutTotals` a secas. Un cálculo y un hecho persistido no son el mismo tipo. |
| D2 | El decremento es **condicional** (compare-and-swap) dentro de la transacción. La corrección no depende del nivel de aislamiento de SQLite. |
| D3 | El `409` del paso de validación reporta **todas** las líneas deficitarias. Divergencia deliberada del fail-fast de `resolveCart`. |
| D4 | `OrderRepository` y su token se **eliminan**: subsumidos por `PurchaseConfirmationPort`. Sus tipos (`NewOrder`, `NewOrderLine`, `PersistedOrder`) se conservan. |
| D5 | Sin migración. El schema de `backend-persistence` ya modela `Order` y `OrderItem` con todo lo necesario. |

## Architecture

```
POST /api/checkout/preview ─┐
POST /api/checkout ─────────┴─► http/         CheckoutController + CheckoutRequestDto
                                              orquesta y valida el cuerpo. Cero reglas.
                                   │
                                   ▼
                                application/   CheckoutService
                                              lee catálogo, invoca el motor, valida
                                              stock, arma la orden, delega la compra.
                                   │
                                   ▼ (tokens de inyección)
                                domain/        ProductRepository, PurchaseConfirmationPort,
                                              normalizeCart, findShortages,
                                              verifyStockDecrements
                                              sin Prisma, sin NestJS, sin HTTP.
                                   ▲
                                   │ implements
                                infra/prisma/  PrismaPurchaseConfirmation
                                              $transaction + updateMany condicional.
```

### Archivos

```
packages/shared/src/domain/
  order.contracts.ts            # OrderConfirmation, StockShortage, CheckoutRequest  [nuevo]
packages/shared/src/index.ts    # exporta los contratos nuevos                       [editado]

apps/backend/src/
  domain/
    purchase.port.ts            # PurchaseConfirmationPort                           [nuevo]
    stock.ts                    # normalizeCart, findShortages, verifyStockDecrements[nuevo]
    stock.spec.ts               #                                                    [nuevo]
    tokens.ts                   # + PURCHASE_PORT, − ORDER_REPOSITORY                [editado]
    order.repository.ts         # − interfaz OrderRepository, tipos intactos         [editado]
  application/
    checkout.service.ts         #                                                    [nuevo]
    checkout.service.spec.ts    #                                                    [nuevo]
  http/
    checkout.dto.ts             # CheckoutRequestDto con class-validator             [nuevo]
    checkout.controller.ts      #                                                    [nuevo]
    checkout.controller.spec.ts #                                                    [nuevo]
    checkout.module.ts          # binding del token, en un solo lugar                [nuevo]
  infra/prisma/
    prisma-purchase.repository.ts # excluido de cobertura si queda sin ramas         [nuevo]
  app.module.ts                 # + CheckoutModule                                   [editado]

apps/backend/test/
  doubles/in-memory-purchase.port.ts #                                               [nuevo]
  checkout.e2e-spec.ts          #                                                    [nuevo]
```

`stock.ts` vive en `domain` y no en `application` por la misma razón que `product-mapper.ts` en la
entrega anterior: son funciones puras sobre tipos estructurales, se prueban sin contenedor y quedan
dentro de la medición de cobertura.

## Contratos compartidos

```ts
// packages/shared/src/domain/order.contracts.ts

/** Petición de ambos endpoints. El cliente NUNCA envía montos. */
export interface CheckoutRequest {
  readonly items: readonly CartItem[];
  readonly couponCode?: string;
}

export interface OrderConfirmationItem {
  readonly productId: string;
  readonly name: string;
  readonly category: ProductCategory;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
}

export interface OrderConfirmation {
  readonly orderId: string;
  /** ISO-8601. Nunca `Date`: es lo que cruza el cable tras JSON.stringify. */
  readonly createdAt: string;
  /** Ausente = sin cupón. Bajo exactOptionalPropertyTypes, ausente ≠ undefined. */
  readonly couponCode?: string;
  readonly items: readonly OrderConfirmationItem[];
  readonly totals: CheckoutTotals;
}

export interface StockShortage {
  readonly productId: string;
  readonly requested: number;
  readonly available: number;
}
```

Tres decisiones de forma que conviene dejar razonadas:

**`items`, no `lines`.** `CheckoutTotals.lines` ya son las `DiscountLine[]` del desglose. Dos
`lines` con significados distintos dentro de la misma respuesta sería una confusión garantizada.
`items` además calca la relación `Order.items` del schema.

**`totals` embebido, no aplanado.** `OrderConfirmation` compone `CheckoutTotals` entero en vez de
copiar sus campos. El componente de desglose del frontend sirve igual para `preview` y para la
confirmación, sin ramas, y la forma del desglose tiene una sola declaración.

**`CheckoutRequest` existe porque tiene un consumidor.** `CheckoutRequestDto` lo declara con
`implements`, así que `tsc` verifica que la clase decorada del backend no se separe del contrato
que consumirá el frontend. No es un tipo especulativo: es la prueba en compilación de que el DTO y
el contrato coinciden.

## Dominio

### Puerto de confirmación de compra

```ts
// src/domain/purchase.port.ts
export interface PurchaseConfirmationPort {
  /** Decrementa el stock de todas las líneas y crea la orden como UNA unidad atómica. */
  confirm(order: NewOrder): Promise<PersistedOrder>;
}
```

Una sola operación, no dos. Es lo que hace desaparecer a `OrderRepository`: su `create` no podía
ejecutarse fuera de la transacción del decremento sin filtrar el cliente transaccional a la firma
del repositorio, que es justo la dependencia que el puerto existe para evitar (D4).

### Normalización, déficit y verificación

```ts
// src/domain/stock.ts

/** Suma las cantidades por producto: dos líneas del mismo producto son una sola exigencia. */
export const normalizeCart = (
  items: readonly CartItem[],
  catalog: readonly Product[],
): readonly StockRequirement[] => { /* ... */ };

/** Deficitarias, en orden ascendente por productId para que la respuesta sea determinista. */
export const findShortages = (
  requirements: readonly StockRequirement[],
): readonly StockShortage[] =>
  requirements
    .filter((r) => r.requested > r.available)   // estrictamente mayor: igualdad NO rechaza
    .map(({ productId, requested, available }) => ({ productId, requested, available }))
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));

/** Guarda del compare-and-swap. Lanza si alguna actualización no afectó fila. */
export const verifyStockDecrements = (outcomes: readonly StockDecrementOutcome[]): void => {
  const contended = outcomes.filter((o) => o.affectedRows === 0).map((o) => o.productId);
  if (contended.length === 0) return;
  throw new DiscountDomainError(
    'INSUFFICIENT_STOCK',
    'El stock cambió mientras se confirmaba la compra.',
    { contendedProductIds: contended },
  );
};
```

**Por qué la guarda no reporta `StockShortage[]`.** El compare-and-swap sabe que la fila ya no
cumplía la condición, pero no cuánto stock quedaba: leerlo otra vez daría un valor que también
puede haber cambiado. Así que los dos `409` comparten código y difieren en detalles, y es correcto
que difieran porque describen situaciones distintas:

| origen | detalles | significado |
|---|---|---|
| Validación contra el snapshot | `shortages: StockShortage[]` | "pediste 5 y hay 3" — el usuario corrige el carrito |
| Guarda del decremento | `contendedProductIds: string[]` | "alguien se llevó las unidades mientras comprabas" — reintentar |

`verifyStockDecrements` existe como función aparte por una razón concreta y no por estética: deja
la guarda fuera del adaptador Prisma, donde no podría probarse sin doblar el cliente `tx`.

## Aplicación: `CheckoutService`

```ts
@Injectable()
export class CheckoutService {
  private readonly engine = new DiscountEngine(new DiscountStrategyFactory().create());

  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(PURCHASE_PORT) private readonly purchase: PurchaseConfirmationPort,
  ) {}

  async preview(request: CheckoutRequest): Promise<CheckoutTotals> { /* 2 → 3 */ }
  async confirm(request: CheckoutRequest): Promise<OrderConfirmation> { /* 1 → 7 */ }
}
```

El motor se arma desde `DiscountStrategyFactory`. El servicio **no** redeclara tasas, umbrales,
precedencia ni el tope, y **no ejecuta ninguna operación de redondeo**: la política completa vive en
`packages/shared`. La única aritmética de dinero del servicio es `priceCents × quantity`, producto
de enteros, exacto.

### Secuencia de `confirm`

| # | paso | falla con |
|---|------|-----------|
| 1 | Carrito vacío → rechazo | `400 INVALID_CART` |
| 2 | Leer el catálogo con `ProductRepository` | `500` |
| 3 | `engine.calculate({ items, catalog, couponCode })` | `404 PRODUCT_NOT_FOUND`, `400 INVALID_CART` |
| 4 | `normalizeCart` + `findShortages` | `409 INSUFFICIENT_STOCK` con `shortages` |
| 5 | Armar `NewOrder` desde las exigencias normalizadas y los totales | — |
| 6 | `purchase.confirm(order)` → CAS + creación, atómico | `409` con `contendedProductIds`, `500` |
| 7 | Mapear `PersistedOrder` + catálogo → `OrderConfirmation` | — |

**El orden es la parte importante.** Validar y calcular antes de escribir hace que un checkout
rechazado no llegue a tocar la base. El rollback de la transacción cubriría el caso igualmente, pero
que sea cierto por construcción y no por deshacer es lo que permite afirmarlo en un test unitario
sin base de datos.

El paso 3 va antes del 4 a propósito: un producto inexistente responde `404` y no `409`. `resolveCart`
ya emite ese error con sus detalles, así que el backend no reimplementa validación de carrito. La
única regla de carrito que sí añade es el paso 1, y no es una regla de validez —`preview` acepta el
carrito vacío y devuelve ceros— sino del endpoint: una compra sin productos no es una orden.

El paso 5 usa las exigencias **normalizadas**, así que la orden persistida tiene una línea por
producto distinto aunque el carrito trajera el mismo producto repetido. `unitPriceCents` sale del
catálogo leído en el paso 2 y `lineTotalCents` es `unitPriceCents × quantity`: los montos
efectivamente cobrados quedan congelados en la fila, y la orden sigue siendo auditable si el precio
del catálogo cambia después.

El paso 7 toma `name` del catálogo del paso 2, porque `OrderItem` no lo almacena. El precio unitario
y el total de línea sí vienen de la orden persistida.

## Infraestructura: el adaptador

```ts
@Injectable()
export class PrismaPurchaseConfirmation implements PurchaseConfirmationPort {
  constructor(private readonly prisma: PrismaService) {}

  confirm(order: NewOrder): Promise<PersistedOrder> {
    return this.prisma.$transaction(async (tx) => {
      const outcomes: StockDecrementOutcome[] = [];

      for (const line of order.lines) {
        const { count } = await tx.product.updateMany({
          where: { id: line.productId, stock: { gte: line.quantity } },
          data:  { stock: { decrement: line.quantity } },
        });
        outcomes.push({ productId: line.productId, requested: line.quantity, affectedRows: count });
      }

      verifyStockDecrements(outcomes);      // lanza ⇒ rollback de todo

      const created = await tx.order.create({ /* ... */ include: { items: true } });
      return toPersistedOrder(created);
    });
  }
}
```

Tres puntos:

- **La condición y la escritura son la misma operación.** `where: { stock: { gte: quantity } }` es lo
  que hace que la corrección no dependa del aislamiento del motor. Es optimistic concurrency
  control, en una línea.
- **`decrement` es atómico**: se traduce a `SET stock = stock - ?`. No hay leer-modificar-escribir.
- **El adaptador no decide nada**: emite las actualizaciones, junta los resultados y delega en
  `verifyStockDecrements`. Esa ausencia de ramas propias es lo que autoriza su exclusión de la
  medición de cobertura; si al implementarlo le aparecen ramas, se mide.

## HTTP

```ts
@Controller('checkout')                         // con el prefijo global => /api/checkout
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)                      // Nest devuelve 201 por defecto en @Post()
  preview(@Body() body: CheckoutRequestDto): Promise<CheckoutTotals> {
    return this.checkout.preview(body);
  }

  @Post()                                       // 201 por defecto, que es el que queremos
  confirm(@Body() body: CheckoutRequestDto): Promise<OrderConfirmation> {
    return this.checkout.confirm(body);
  }
}
```

El `@HttpCode(HttpStatus.OK)` de `preview` no es cosmético: sin él, previsualizar devolvería `201
Created` sin haber creado nada.

```ts
// checkout.dto.ts
class CartItemDto implements CartItem {
  @IsString() @IsNotEmpty() productId!: string;
  @IsInt() @Min(1) quantity!: number;
}

export class CheckoutRequestDto implements CheckoutRequest {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CartItemDto)
  items!: CartItemDto[];

  @IsOptional() @IsString() @IsNotEmpty()
  couponCode?: string;
}
```

El DTO declara **solo** líneas y cupón. No hay campo donde el cliente pueda mandar un subtotal, un
descuento o un total: con `forbidNonWhitelisted` ya activo en el `ValidationPipe` global, intentarlo
devuelve `400` sin llegar al servicio. Es la parte del contrato que hace estructuralmente imposible
que el cliente influya en los montos.

El binding del token vive en `checkout.module.ts` y en ningún otro sitio, igual que
`PRODUCT_REPOSITORY` en `ProductsModule`, para que el e2e lo sustituya con `.overrideProvider()`.

## Error Handling

Sin bloques de captura en el controlador: el `ApiExceptionFilter` existente traduce, con su
`Record<ErrorCode, number>` ya exhaustivo.

| origen | código | estado | detalles |
|---|---|---|---|
| Carrito vacío en `checkout` | `INVALID_CART` | `400` | — |
| Cuerpo que no satisface el DTO | (`HttpException` de Nest) | `400` | cuerpo del `ValidationPipe` |
| Producto inexistente (`resolveCart`) | `PRODUCT_NOT_FOUND` | `404` | `lineIndex`, `productId` |
| Cantidad o precio inválidos (`resolveCart`) | `INVALID_CART` | `400` | `lineIndex`, `productId` |
| Déficit contra el snapshot | `INSUFFICIENT_STOCK` | `409` | `shortages[]` |
| Guarda del decremento | `INSUFFICIENT_STOCK` | `409` | `contendedProductIds[]` |
| Fallo de la transacción por otra causa | `INTERNAL_ERROR` | `500` | ninguno; la excepción va al log |

Un cupón desconocido o expirado **no aparece en esta tabla**: `resolveCart` lo resuelve a "sin
cupón" y la cascada continúa con la línea marcada `applied: false`.

## Testing Strategy

Todo por ejemplo, con dobles tipados y sin base de datos. Los dobles: `InMemoryProductRepository`
—ya existe de la entrega anterior— y `InMemoryPurchasePort`, que registra los decrementos y las
órdenes creadas para poder afirmar que **no** hubo ninguno.

**Unitarios de `stock.ts`** (funciones puras, es donde están las ramas):

| función | casos |
|---|---|
| `normalizeCart` | una línea; dos líneas del mismo producto que se suman; catálogo vacío |
| `findShortages` | sin déficit; un déficit; dos déficits ordenados por `productId`; cantidad **igual** al stock, que no es déficit |
| `verifyStockDecrements` | todas afectan fila (no lanza); alguna no afecta (lanza con `contendedProductIds`) |

**Unitarios de `CheckoutService`**, con los casos borde que exige el enunciado:

- Stock insuficiente: `409`, código, todas las líneas deficitarias en detalles, y el doble **sin
  decrementos y sin orden creada**.
- Frontera con `PROD-005` (stock `3`): cantidad `3` continúa, cantidad `4` rechaza.
- Carrito vacío: `preview` devuelve ahorro cero; `confirm` responde `400 INVALID_CART` sin persistir.
- Carrito corrupto: producto inexistente → `404`; cantidad no positiva → `400`.
- Cupones: `WELCOME2026` aplicado en su orden; `SUMMER2024` expirado ignorado; código no registrado
  ignorado; `DEMOCAP50` con el indicador de tope aplicado en los totales y persistido en la orden.
- `preview` no toca stock ni órdenes ni siquiera pidiendo más unidades de las disponibles.
- Igualdad `preview` vs `confirm`: mismo carrito, comparación campo por campo de los totales.
- Guarda del CAS: el doble devuelve `affectedRows: 0` en una línea ⇒ la unidad aborta, sin
  decrementos y sin orden. **Un escenario**: es una guarda de carrera, no una regla con casos.

**e2e (`test/checkout.e2e-spec.ts`)** con supertest, arrancando el módulo con `PRODUCT_REPOSITORY` y
`PURCHASE_PORT` sustituidos por dobles: `preview` → `200`, `confirm` → `201` con la forma de
`OrderConfirmation`, y un cuerpo inválido → `400`.

**Cobertura.** El umbral del 80% en líneas y ramas sigue rompiendo el comando. Dentro de la medición
quedan `CheckoutService`, `CheckoutController`, `CheckoutRequestDto` y `stock.ts`. Se excluye
`prisma-purchase.repository.ts` **solo si** queda sin ramas propias, como está diseñado.

## Invariantes verificadas

| # | invariante | verificado por |
|---|---|---|
| I1 | Dos líneas del mismo producto se evalúan por su suma, no una por una | `stock.spec.ts` |
| I2 | El rechazo es por cantidad **estrictamente mayor** al stock; la igualdad continúa | `stock.spec.ts`, servicio |
| I3 | Un rechazo por stock no decrementa nada ni persiste orden alguna | servicio, con doble |
| I4 | La validez del carrito se evalúa antes que el stock: producto inexistente da `404`, no `409` | servicio |
| I5 | `preview` y `confirm` producen montos idénticos para el mismo carrito y cupón | servicio, campo por campo |
| I6 | `preview` no tiene efectos observables sobre stock ni órdenes | servicio, e2e |
| I7 | Una actualización condicional sin filas afectadas aborta la unidad completa | `stock.spec.ts`, servicio |
| I8 | El cliente no puede influir en los montos | **estructural**: el DTO no tiene campos de monto y `forbidNonWhitelisted` rechaza los ajenos |
| I9 | El stock decrementado sobrevive al reinicio del proceso | **estructural** (el arranque no escribe) + demo en vivo |

I8 e I9 no llevan prueba a propósito, y por el mismo motivo que el invariante I10 de
`backend-persistence`: son ausencias, no comportamientos. No hay campo de monto que testear, y
probar que el arranque no escribe exigiría espiar todos los métodos mutadores de Prisma para
afirmar que nunca se llaman. La verificación real de I9 es la de la sustentación: comprar, reiniciar
el proceso y ver que `GET /api/products` sigue devolviendo el stock decrementado.
