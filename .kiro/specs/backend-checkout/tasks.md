# Implementation Plan: backend-checkout

## Overview

Se construye de abajo hacia arriba, igual que la entrega anterior: primero los contratos
compartidos, luego el dominio puro —puerto y funciones de stock—, el doble de prueba, el caso de
uso, la capa HTTP y, al final, el adaptador Prisma con el wiring del token. Los dos endpoints
quedan operativos recién en el último tramo, cuando el binding `PURCHASE_PORT →
PrismaPurchaseConfirmation` cierra la cadena.

Lenguaje: TypeScript con `strict: true`. Cero `any`, cero assertions salvo `as const` y
`satisfies`. Todas las pruebas son **por ejemplo**, con tablas de casos fijos: sin testing basado
en propiedades y sin generadores.

## Tasks

- [x] 1. Contratos compartidos en `@core/shared`
  - [x] 1.1 Crear `packages/shared/src/domain/order.contracts.ts` y exportarlo
    - `CheckoutRequest` (`items: readonly CartItem[]`, `couponCode?: string`), `OrderConfirmationItem`, `OrderConfirmation` y `StockShortage`, todos con propiedades `readonly`
    - `OrderConfirmation.totals` es `CheckoutTotals` **embebido**, no aplanado: una sola declaración de la forma del desglose para `preview` y para `checkout`
    - `createdAt: string` (ISO-8601) y `couponCode?: string`: el contrato describe lo que cruza el cable, no el `Date` de Prisma ni un `null`
    - El campo de líneas se llama `items` para no colisionar con `CheckoutTotals.lines`, que son las `DiscountLine[]` del desglose
    - Exportar los cuatro tipos desde `packages/shared/src/index.ts`, sin rutas internas
    - Sin spec propio: son declaraciones de tipo, no aportan líneas ejecutables ni mueven la cobertura de `packages/shared`
    - _Requisitos: BC-R1.1, BC-R1.2, BC-R1.3, BC-R1.4, BC-R1.5_

- [x] 2. Dominio: puerto, tokens y funciones puras de stock
  - [x] 2.1 Declarar el puerto y limpiar lo que subsume
    - `src/domain/purchase.port.ts` con `PurchaseConfirmationPort.confirm(order: NewOrder): Promise<PersistedOrder>`: **una sola operación**, porque el decremento y la creación son una unidad atómica
    - Añadir `PURCHASE_PORT` a `src/domain/tokens.ts` y **eliminar** `ORDER_REPOSITORY`
    - En `src/domain/order.repository.ts`, **eliminar la interfaz `OrderRepository`** y conservar `NewOrderLine`, `NewOrder` y `PersistedOrder`, que son la forma de la orden que el puerto recibe y devuelve
    - El puerto se expresa en términos de `@core/shared` y de esos tipos: sin Prisma, sin transacciones concretas, sin tipos del ORM
    - _Requisitos: BC-R5.3, BC-R6.1, BC-R6.5_

  - [x] 2.2 Implementar `src/domain/stock.ts`
    - `StockRequirement` y `StockDecrementOutcome` como tipos estructurales
    - `normalizeCart(items, catalog)`: suma las cantidades **por producto**, de modo que dos líneas del mismo producto sean una sola exigencia
    - `findShortages(requirements)`: filtra por `requested > available` —estrictamente mayor, la igualdad no es déficit— y ordena ascendente por `productId` para que la respuesta sea determinista
    - `verifyStockDecrements(outcomes)`: lanza `DiscountDomainError('INSUFFICIENT_STOCK', …, { contendedProductIds })` cuando alguna actualización no afectó fila; no reporta `available` porque el compare-and-swap no lo conoce y releerlo daría un valor igual de obsoleto
    - Sin imports de Prisma, NestJS ni HTTP: la regla `no-restricted-imports` sobre `src/domain` lo verifica en el lint
    - _Requisitos: BC-R4.1, BC-R4.2, BC-R4.3, BC-R6.6_

  - [x] 2.3 Escribir `src/domain/stock.spec.ts`
    - `normalizeCart`: una línea; dos líneas del mismo producto que se suman; catálogo vacío
    - `findShortages`: sin déficit; un déficit; dos déficits ordenados por `productId`; cantidad **igual** al stock, que no es déficit
    - `verifyStockDecrements`: todas afectan fila (no lanza); alguna no afecta (lanza con `contendedProductIds`)
    - Tablas `it.each` con casos fijos, sin generadores
    - _Requisitos: BC-R8.3, BC-R8.9_

- [x] 3. Doble de prueba del puerto
  - [x] 3.1 Crear `test/doubles/in-memory-purchase.port.ts`
    - `InMemoryPurchasePort implements PurchaseConfirmationPort`, con un almacén de stock, la lista de órdenes creadas y contadores, para poder afirmar que **no** hubo decrementos ni órdenes
    - Modo de fallo configurable que devuelva `affectedRows: 0` en una línea, para ejercitar la guarda del compare-and-swap sin base de datos
    - Tipado completo: sin `any`, sin assertions de tipo, sin `@ts-ignore`
    - `InMemoryProductRepository` ya existe de `backend-persistence` y se reutiliza tal cual
    - _Requisitos: BC-R8.1_

- [x] 4. Caso de uso: `CheckoutService`
  - [x] 4.1 Implementar `preview`
    - `src/application/checkout.service.ts` con el motor armado desde `new DiscountEngine(new DiscountStrategyFactory().create())` y los dos puertos inyectados por token
    - `preview(request)`: obtiene el catálogo del `ProductRepository` y lo pasa al motor con las líneas y el cupón, de modo que los precios sean los persistidos y no los del cliente
    - **Sin comprobar stock y sin efectos**: una cantidad superior al stock obtiene igualmente su desglose
    - El servicio no redeclara tasas, umbrales, precedencia, redondeo ni el tope, y no ejecuta ninguna operación de redondeo
    - _Requisitos: BC-R3.2, BC-R3.4, BC-R3.5, BC-R3.6, BC-R6.3_

  - [x] 4.2 Implementar `confirm`
    - Secuencia exacta del diseño: (1) carrito vacío → `INVALID_CART`; (2) leer catálogo; (3) `engine.calculate` —que emite `PRODUCT_NOT_FOUND` e `INVALID_CART`—; (4) `normalizeCart` + `findShortages` → `INSUFFICIENT_STOCK` con `shortages`; (5) armar `NewOrder`; (6) `purchase.confirm`; (7) mapear a `OrderConfirmation`
    - El orden importa: validar y calcular **antes** de escribir hace que un rechazo no toque la base por construcción, no por rollback
    - El paso 5 usa las exigencias **normalizadas**, así que hay una línea de orden por producto distinto; `unitPriceCents` sale del catálogo leído y `lineTotalCents` es `unitPriceCents × quantity`, producto de enteros
    - El paso 7 toma `name` del catálogo, porque `OrderItem` no lo almacena; el precio unitario y el total de línea vienen de la orden persistida
    - Sin `try/catch`: los errores tipados suben al `ApiExceptionFilter`
    - _Requisitos: BC-R4.4, BC-R4.5, BC-R4.6, BC-R5.2, BC-R5.6, BC-R6.3, BC-R7.1, BC-R7.3_

  - [x] 4.3 Escribir `src/application/checkout.service.spec.ts`
    - Stock insuficiente: código `INSUFFICIENT_STOCK`, **todas** las líneas deficitarias en los detalles, y el doble sin decrementos y sin orden creada
    - Frontera con `PROD-005` (stock `3`): cantidad `3` continúa, cantidad `4` rechaza
    - Carrito vacío: `preview` devuelve ahorro cero sin excepción; `confirm` falla con `INVALID_CART` sin persistir
    - Carrito corrupto: producto inexistente → `PRODUCT_NOT_FOUND`; cantidad no positiva → `INVALID_CART`
    - Cupones: `WELCOME2026` aplicado en su orden de precedencia; `SUMMER2024` expirado ignorado sin interrumpir la cascada; código no registrado ignorado igual; `DEMOCAP50` con el indicador de tope aplicado en los totales **y persistido en la orden**
    - `preview` no modifica stock ni crea órdenes ni pidiendo más unidades de las disponibles
    - Igualdad `preview` / `confirm`: mismo carrito y cupón, comparación campo por campo de los totales
    - Guarda del compare-and-swap: el doble devuelve `affectedRows: 0` en una línea y la unidad aborta sin decrementos y sin orden. **Un solo escenario**: es una guarda de carrera, no una regla de negocio con casos
    - _Requisitos: BC-R8.2, BC-R8.3, BC-R8.4, BC-R8.5, BC-R8.6, BC-R8.7, BC-R8.8, BC-R8.9_

- [x] 5. Capa HTTP
  - [x] 5.1 Escribir `src/http/checkout.dto.ts`
    - `CartItemDto implements CartItem` con `@IsString() @IsNotEmpty()` en `productId` y `@IsInt() @Min(1)` en `quantity`
    - `CheckoutRequestDto implements CheckoutRequest` con `@IsArray() @ValidateNested({ each: true }) @Type(() => CartItemDto)` y `couponCode` con `@IsOptional() @IsString() @IsNotEmpty()`
    - El `implements` no es decorativo: es la comprobación en compilación de que la clase decorada no se separa del contrato compartido
    - **Solo líneas y cupón**: ningún campo donde el cliente pueda enviar subtotales, descuentos ni totales
    - _Requisitos: BC-R1.1, BC-R2.1, BC-R2.2, BC-R2.4_

  - [x] 5.2 Implementar `checkout.controller.ts` y `checkout.module.ts`
    - `@Controller('checkout')` con `@Post('preview')` y `@Post()`, cada uno delegando en una única llamada al servicio: sin `try/catch`, sin transacciones, sin reglas
    - **`@HttpCode(HttpStatus.OK)` en `preview`**: el valor por defecto de Nest para un `@Post()` es `201`, y previsualizar no crea nada. `confirm` se queda con el `201` por defecto, que sí es el correcto
    - `checkout.module.ts` importa `PrismaModule`, declara el controlador y provee `CheckoutService` más los bindings de `PRODUCT_REPOSITORY` y `PURCHASE_PORT`, en un único lugar, para que el e2e los sustituya con `.overrideProvider()`
    - _Requisitos: BC-R3.1, BC-R3.3, BC-R5.1, BC-R5.5, BC-R6.2, BC-R7.2_

  - [x] 5.3 Escribir `src/http/checkout.controller.spec.ts`
    - Con un `CheckoutService` doble: cada endpoint delega en una única llamada y devuelve el resultado sin transformarlo
    - _Requisitos: BC-R8.1_

- [x] 6. Checkpoint - Dominio, aplicación y HTTP verificados
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Adaptador Prisma y wiring
  - [x] 7.1 Implementar `src/infra/prisma/prisma-purchase.repository.ts` y cablear
    - `PrismaPurchaseConfirmation implements PurchaseConfirmationPort`, tomando el acceso a datos del `PrismaService` existente, sin instanciar cliente propio
    - Dentro de `$transaction`: por cada línea, `updateMany({ where: { id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } })`, recogiendo `count` en un `StockDecrementOutcome`
    - Después del bucle, `verifyStockDecrements(outcomes)`: lanzar aborta la transacción entera. El adaptador **no decide nada**, y esa ausencia de ramas propias es lo que autoriza su exclusión de cobertura; si al implementarlo le aparecen ramas, se mide
    - Crear la orden con sus `items` en la misma transacción y mapear a `PersistedOrder`
    - Registrar `CheckoutModule` en `src/app.module.ts`
    - Sin migración: el schema ya modela `Order` y `OrderItem` con todo lo necesario
    - _Requisitos: BC-R5.3, BC-R5.4, BC-R6.4, BC-R6.5, BC-R8.11_

- [x] 8. Prueba end-to-end
  - [x] 8.1 Escribir `test/checkout.e2e-spec.ts`
    - Arrancar el módulo con `PRODUCT_REPOSITORY` y `PURCHASE_PORT` sustituidos por los dobles en memoria, con `setGlobalPrefix('api')`, el `ValidationPipe` global y `useGlobalFilters(new ApiExceptionFilter())`
    - `POST /api/checkout/preview` → `200` con la forma `CheckoutTotals`
    - `POST /api/checkout` → `201` con la forma `OrderConfirmation`
    - Cuerpo inválido —propiedad ajena, `items` ausente o que no es arreglo— → `400`, sin llegar al servicio
    - Stock insuficiente → `409` con la forma `ApiError` y las líneas deficitarias
    - Sin base de datos: los adaptadores Prisma se sustituyen por dobles
    - _Requisitos: BC-R2.3, BC-R4.3, BC-R5.7, BC-R7.1, BC-R8.10_

- [x] 9. Documentación de la entrega
  - [x] 9.1 Actualizar `.kiro/steering/product-rules.md`
    - Añadir `OrderConfirmation`, `OrderConfirmationItem`, `CheckoutRequest` y `StockShortage` a la sección del contrato de la API, junto a `CheckoutTotals`
    - Completar la tabla de endpoints con el cuerpo de respuesta y el estado de cada uno (`200` en `preview`, `201` en `checkout`)
    - Documentar los dos `409` y su diferencia de detalles: `shortages` en la validación, `contendedProductIds` en la guarda del decremento
    - Es el archivo canónico del contrato; si `OrderConfirmation` nace solo en el código, el steering y la implementación divergen
    - _Requisitos: BC-R1.1, BC-R1.5, BC-R4.3_

  - [x] 9.2 Ampliar `docs/arquitectura.md`
    - El puerto de confirmación de compra como patrón: por qué el decremento y la creación son una sola operación y por qué eso hizo desaparecer a `OrderRepository`
    - El compare-and-swap: por qué la corrección no depende del nivel de aislamiento de SQLite, y por qué la validación previa sigue existiendo aunque la guarda la cubra (una informa al usuario, la otra protege al sistema)
    - Por qué `preview` y `checkout` no pueden divergir: una sola implementación del motor y del redondeo en `packages/shared`
    - _Requisitos: BC-R5.2, BC-R5.4, BC-R6.5_

- [x] 10. Checkpoint final - Umbral de cobertura y suites de la raíz
  - Ejecutar `npm run typecheck`, `npm run lint` y `npm run test:cov` en la raíz, verificando que los tres workspaces pasan y que el umbral del 80% en líneas y ramas se cumple en `apps/backend`
  - Comprobar que `CheckoutService`, `CheckoutController`, `CheckoutRequestDto` y `stock.ts` quedan dentro de la medición
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- **Ninguna subtarea es opcional.** Lo que quedó en el plan o entrega un endpoint o sostiene el
  umbral del 80%.
- `order.contracts.ts` no lleva spec: son declaraciones de tipo y no aportan líneas ejecutables.
  Quien las verifica es `tsc`, en el `implements` del DTO y en el mapeo del servicio.
- Las únicas piezas con ramas de esta entrega son `stock.ts` y `CheckoutService`. Son las que
  concentran las pruebas; el resto se cubre por delegación y por el e2e.
- La tarea 2.1 **elimina código de `backend-persistence`** (`OrderRepository` y `ORDER_REPOSITORY`).
  Es deliberado y no rompe nada: la interfaz nunca tuvo consumidor, que es justamente el argumento
  para retirarla ahora que el puerto la subsume.
- Verificaciones que deliberadamente **no** son tests: que el cliente no pueda influir en los montos
  (estructural — el DTO no tiene campos de monto y `forbidNonWhitelisted` rechaza los ajenos), la
  supervivencia del stock decrementado al reiniciar el proceso (estructural + demo en vivo), y el
  comportamiento del `ValidationPipe`, del que el e2e afirma solo el estado.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2"] },
    { "id": 1, "tasks": ["2.3", "3.1", "4.1"] },
    { "id": 2, "tasks": ["4.2", "5.1"] },
    { "id": 3, "tasks": ["4.3", "5.2"] },
    { "id": 4, "tasks": ["5.3", "7.1"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["9.1", "9.2"] }
  ]
}
```
