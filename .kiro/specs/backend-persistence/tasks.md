# Implementation Plan: backend-persistence

## Overview

Se construye `apps/backend` de abajo hacia arriba, en el orden que el diseño impone: primero el
cambio aditivo en el contrato de error compartido (`INTERNAL_ERROR`), luego el andamiaje del
workspace con su Jest y su umbral, después el schema y el seed, la capa de dominio pura, los dobles
de prueba, la aplicación y el HTTP, y al final la infraestructura Prisma con el wiring del token.
El endpoint `GET /api/products` queda operativo recién en el último tramo, cuando el binding
`PRODUCT_REPOSITORY → PrismaProductRepository` cierra la cadena.

Lenguaje: TypeScript con `strict: true`. Cero `any`, cero assertions salvo `as const` y `satisfies`.
Todas las pruebas son **por ejemplo**, con tablas de casos fijos: no se usa testing basado en
propiedades ni `fast-check`, en coherencia con `discount-engine`, que alcanzó el 100% de cobertura
sobre la lógica más difícil del proyecto sin esa maquinaria.

## Tasks

- [x] 1. Extender el contrato de error compartido con `INTERNAL_ERROR`
  - [x] 1.1 Añadir `'INTERNAL_ERROR'` a `ERROR_CODES` en `packages/shared/src/domain/errors.ts`
    - Agregar el literal al arreglo `as const`, de modo que `ErrorCode` lo derive sin redeclarar la unión
    - Documentar en comentario que es **extensión de infraestructura ajena al enunciado**, en la misma línea en que `DEMOCAP50` está marcado como extensión de demo
    - No tocar `DiscountDomainError` ni `toApiError`: el cambio es aditivo sobre la unión
    - Verificar que `packages/shared/src/index.ts` sigue exportando `ERROR_CODES` y `ErrorCode` sin cambios
    - _Requisitos: BP-R5.7_

  - [x] 1.2 Actualizar `packages/shared/src/domain/contracts.spec.ts` para los cuatro códigos
    - El test vigente afirma exactamente tres códigos y debe fallar hasta actualizarse: ese fallo es la señal de que la unión es la única fuente de verdad
    - Afirmar el arreglo completo y su orden, con `INTERNAL_ERROR` al final
    - _Requisitos: BP-R5.7_

- [x] 2. Andamiaje del workspace `apps/backend`
  - [x] 2.1 Crear la configuración base del workspace
    - `apps/backend/package.json` con nombre `@core/backend`, versiones **exactas** (sin rangos) según el diseño, scripts `build`, `start`, `typecheck`, `lint`, `test`, `test:cov`, `db:generate`, `db:migrate`, `db:seed`, y el bloque `prisma.seed` apuntando a `prisma/seed.ts` vía `ts-node`
    - `tsconfig.json` que extiende `../../tsconfig.base.json` añadiendo `experimentalDecorators`, `emitDecoratorMetadata`, `rootDir`, `outDir` y `types: ["node", "jest"]`; `tsconfig.build.json` que excluye `**/*.spec.ts` y `test/`
    - `eslint.config.mjs` alineado al del resto de workspaces, **más el bloque `no-restricted-imports` acotado a `src/domain/**/*.ts`** que prohíbe `@prisma/client`, `@nestjs/*`, `express`, `**/infra/**` y `**/http/**`: es la verificación de la pureza del dominio, en lugar de una prueba de arquitectura en runtime
    - `.env.example` versionado con `DATABASE_URL="file:./prisma/dev.db"` y `PORT=3000`
    - Añadir `*.db-wal` y `*.db-shm` al `.gitignore` de la raíz (el resto ya está cubierto)
    - _Requisitos: BP-R1.4, BP-R1.5, BP-R1.6, BP-R2.7, BP-R4.3_

  - [x] 2.2 Crear `apps/backend/jest.config.ts` con el umbral que rompe el comando
    - Preset `ts-jest`, `testEnvironment: 'node'`, `roots` en `src` y `test`, `testRegex` que capture `.spec.ts` y `.e2e-spec.ts`
    - `moduleNameMapper` de `^@core/shared$` al `index.ts` del paquete: entry público, sin rutas internas y sin depender de un build previo
    - `collectCoverageFrom: ['src/**/*.ts', 'prisma/seed.ts']` y `coveragePathIgnorePatterns` con `main.ts`, `prisma.service.ts`, `prisma-product.repository.ts` y los `.spec.ts`
    - `coverageThreshold: { global: { lines: 80, branches: 80 } }`
    - _Requisitos: BP-R6.1, BP-R6.5, BP-R6.6_

- [x] 3. Schema Prisma, migración inicial y seed explícito
  - [x] 3.1 Escribir `apps/backend/prisma/schema.prisma`
    - Datasource `sqlite` con `url = env("DATABASE_URL")`; generator `prisma-client-js`
    - Modelo `Product` con `id` texto como PK, `name`, `category` texto, `priceCents` y `stock` enteros, todos requeridos
    - Modelos `Order` y `OrderItem` con montos en centavos enteros, `capApplied` booleano, `couponCode` opcional, `createdAt`, relaciones hacia `Order` y `Product` e índices; **sin adaptador en esta entrega (D1)**
    - Comentar por qué `category` es `String` y no enum (SQLite) y por qué **no hay modelo `Coupon`** (D3)
    - _Requisitos: BP-R2.1, BP-R2.2, BP-R2.3, BP-R2.4_

  - [x] 3.2 Generar y versionar la migración inicial
    - `prisma/migrations/<timestamp>_init/migration.sql` con los tres `CREATE TABLE`, claves foráneas e índices, más `migration_lock.toml`
    - Debe dejar el esquema completo al aplicar `prisma migrate deploy` sobre una base vacía
    - _Requisitos: BP-R2.5_

  - [x] 3.3 Implementar `apps/backend/prisma/seed.ts`
    - `seedProducts(client: Pick<PrismaClient, 'product'>, products: readonly Product[] = CATALOG_PRODUCTS)` con `upsert` por `id`, donde `update` reescribe también el `stock`
    - `main` instancia el cliente, informa la cantidad escrita, hace `$disconnect` en `finally` y deja `process.exitCode = 1` describiendo el fallo por `stderr`
    - Tomar los productos desde `@core/shared` sin redeclarar ningún dato del catálogo
    - _Requisitos: BP-R3.1, BP-R3.2, BP-R3.3, BP-R3.4, BP-R3.5_

  - [x] 3.4 Prueba de idempotencia de `seedProducts` (`test/seed.spec.ts`)
    - **Invariante I9.** Almacén doble tipado que satisfaga `Pick<PrismaClient, 'product'>`, sin `any`
    - Dos ejecuciones consecutivas desde almacén vacío y desde almacén con stock decrementado; afirmar que las filas resultantes son exactamente `CATALOG_PRODUCTS`, sin duplicados
    - Va en `test/` y no junto a `prisma/seed.ts` porque los `roots` de Jest son `src` y `test`
    - _Requisitos: BP-R3.1, BP-R3.2, BP-R6.3_

- [x] 4. Capa de dominio pura
  - [x] 4.1 Declarar tokens e interfaces de repositorio
    - `src/domain/tokens.ts` con `PRODUCT_REPOSITORY` y `ORDER_REPOSITORY` como literales `as const`
    - `src/domain/product.repository.ts` con `findAll(): Promise<readonly Product[]>` (orden ascendente por `id` como parte del contrato) y `findById(id): Promise<Product | undefined>`
    - `src/domain/order.repository.ts` con `NewOrderLine`, `NewOrder`, `PersistedOrder` y `OrderRepository.create`, **sin implementación concreta y sin doble de prueba (D1)**: ambos llegan en la parte 2 junto a su primer consumidor
    - _Requisitos: BP-R4.1, BP-R4.2, BP-R4.4_

  - [x] 4.2 Implementar el mapeo runtime de fila a `Product` y su error tipado
    - `src/domain/product-mapper.ts` con `PersistedProductRow` estructural, `isProductCategory` como type guard sobre `PRODUCT_CATEGORIES` usando `.some(...)`, y `toProduct` enumerando las cinco claves una por una (sin spread)
    - `src/domain/errors.ts` con `CorruptProductRowError` (guarda `productId` e `invalidCategory`) y su guard `isCorruptProductRowError`
    - Prohibido `as`: el estrechamiento lo hace el predicado
    - _Requisitos: BP-R4.5, BP-R4.7, BP-R5.4_

  - [x] 4.3 Implementar el orden determinista del catálogo
    - `src/domain/product-order.ts` con `compareProductId` (comparación de literales, sin `localeCompare`) y `sortByProductId` que no mute la entrada
    - _Requisitos: BP-R5.5_

  - [x] 4.4 Pruebas por ejemplo del dominio
    - **Invariantes I2, I3 e I5.** Tablas `it.each` con los casos fijos del diseño, sin generadores aleatorios
    - `src/domain/product-mapper.spec.ts`: una fila válida por categoría; una fila con columna extra que no debe propagarse al resultado; y las corruptas `'Tecnología'` con tilde, `'TECNOLOGIA'` y `''`, afirmando `CorruptProductRowError` con `productId` e `invalidCategory`
    - `src/domain/product-order.spec.ts`: catálogo vacío, un solo producto, entrada desordenada, y que el arreglo recibido no se muta
    - _Requisitos: BP-R2.2, BP-R4.5, BP-R4.7, BP-R5.4, BP-R5.5, BP-R6.3_

- [x] 5. Dobles de prueba tipados
  - [x] 5.1 Crear los dobles en memoria
    - `test/doubles/in-memory-product.repository.ts` con `InMemoryProductRepository` (contador de llamadas y `sortByProductId` para honrar el contrato de orden) y `FailingProductRepository`
    - Tipado completo: sin `any`, sin assertions, sin `@ts-ignore`
    - **Sin generadores** (`product.arbitrary.ts`) y **sin doble de `OrderRepository`**: no hay consumidor en esta entrega
    - _Requisitos: BP-R6.2_

- [x] 6. Caso de uso y capa HTTP
  - [x] 6.1 Implementar `CatalogService`
    - `src/application/catalog.service.ts` con `@Inject(PRODUCT_REPOSITORY)` sobre el tipo `ProductRepository`, y `listCatalog(): Promise<readonly Product[]>` que delega sin filtrar ni transformar
    - _Requisitos: BP-R5.2, BP-R4.4_

  - [x] 6.2 Pruebas unitarias de `CatalogService`
    - Catálogo sembrado, catálogo vacío y fallo del repositorio (propagación al filtro), con los dobles de 5.1
    - Afirmar una única llamada a `findAll` por invocación, y que `findById` de un id ausente resuelve `undefined` sin lanzar (**invariante I4**)
    - _Requisitos: BP-R4.6, BP-R6.2, BP-R6.3_

  - [x] 6.3 Implementar `ProductsController`
    - `src/http/products.controller.ts` con `@Controller('products')` y un `@Get()` que devuelve la promesa del servicio: sin `try/catch`, sin acceso al cliente Prisma y sin reglas de negocio
    - _Requisitos: BP-R5.1_

  - [x] 6.4 Pruebas unitarias de `ProductsController`
    - Con un `CatalogService` doble: afirmar que delega en una única llamada y devuelve el catálogo sin transformarlo ni reordenarlo
    - _Requisitos: BP-R5.1, BP-R6.2_

  - [x] 6.5 Implementar `ApiExceptionFilter`
    - `src/http/api-exception.filter.ts` con `STATUS_BY_ERROR_CODE: Record<ErrorCode, number>` exhaustivo (incluido `INTERNAL_ERROR: 500`)
    - Tres caminos: `DiscountDomainError` → estado de la tabla y `toApiError()`; `HttpException` de Nest → su estado y su cuerpo; cualquier otro → `logger.error` con la excepción completa y cuerpo **constante** `ApiError` con `INTERNAL_ERROR`
    - _Requisitos: BP-R5.7_

  - [x] 6.6 Pruebas unitarias de `ApiExceptionFilter`
    - **Invariantes I7 e I8.** Un caso por `ErrorCode` recorriendo `ERROR_CODES`, afirmando estado y cuerpo idéntico a `toApiError()` sin traducir el código
    - Caso de no filtración: un error cuyo mensaje contenga `'/prisma/dev.db'`, un fragmento de SQL y una traza; afirmar `500`, forma `ApiError` y que el cuerpo serializado **no** contiene ninguna de esas subcadenas
    - La exhaustividad del `Record<ErrorCode, number>` la garantiza `tsc`, no el test: el test cubre el comportamiento, no la completitud de la unión
    - _Requisitos: BP-R5.7, BP-R6.3_

- [x] 7. Checkpoint - Dominio, aplicación y HTTP verificados
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Infraestructura Prisma, wiring y bootstrap
  - [x] 8.1 Implementar `PrismaService` y `PrismaModule`
    - `src/infra/prisma/prisma.service.ts`: extiende `PrismaClient`, `onModuleInit` → `$connect`, `onModuleDestroy` → `$disconnect`; único punto del backend que instancia `PrismaClient`; no siembra, no migra, no restaura stock
    - `src/infra/prisma/prisma.module.ts` que lo provee y lo exporta
    - Sin prueba propia: el archivo está excluido de la medición y un test contra un doble verificaría la API de Prisma, no la nuestra. La ausencia de escrituras en el arranque (**invariante I10**) es estructural y se demuestra en la sustentación reiniciando el proceso
    - _Requisitos: BP-R2.6, BP-R3.6_

  - [x] 8.2 Implementar `PrismaProductRepository`
    - `findAll` con `orderBy: { id: 'asc' }` y `rows.map(toProduct)`; `findById` convirtiendo `null` de Prisma a `undefined`
    - Sin lógica propia: consulta y delegación, que es lo que autoriza su exclusión de cobertura
    - _Requisitos: BP-R4.5, BP-R4.6, BP-R5.5, BP-R6.6_

  - [x] 8.3 Cablear los módulos
    - `src/http/products.module.ts` que importa `PrismaModule`, declara el controlador y provee `CatalogService` más el binding `{ provide: PRODUCT_REPOSITORY, useClass: PrismaProductRepository }` en un único lugar
    - `src/app.module.ts` que importa `PrismaModule` y `ProductsModule`
    - _Requisitos: BP-R4.4_

  - [x] 8.4 Implementar `resolvePort` y el bootstrap
    - `src/port.ts` con `DEFAULT_PORT = 3000` y `resolvePort(raw: string | undefined)` total: entero en `1..65535` o el default
    - `src/main.ts` con `setGlobalPrefix('api')`, `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`), `useGlobalFilters(new ApiExceptionFilter())` y `listen(resolvePort(process.env.PORT))`
    - _Requisitos: BP-R1.1, BP-R1.2, BP-R1.3_

  - [x] 8.5 Pruebas por ejemplo de `resolvePort` (`src/port.spec.ts`)
    - **Invariante I1.** `it.each` con `undefined`, `''`, `'abc'`, `'3.5'`, `'-1'`, `'0'` y `'70000'` → `3000`; `'8080'` → `8080`
    - _Requisitos: BP-R1.3, BP-R6.3_

- [x] 9. Prueba end-to-end de `GET /api/products`
  - [x] 9.1 Escribir `test/products.e2e-spec.ts` con supertest
    - `Test.createTestingModule({ imports: [ProductsModule] })` con `.overrideProvider(PRODUCT_REPOSITORY).useValue(new InMemoryProductRepository())`, `setGlobalPrefix('api')` y `useGlobalFilters(new ApiExceptionFilter())`
    - Afirmar `GET /api/products` → `200` con el catálogo completo (seis elementos, cinco claves, valores idénticos a `CATALOG_PRODUCTS`, orden ascendente por `id`), catálogo vacío → `200` con `[]`, fallo del repositorio → `500` con forma `ApiError`, y `GET /products` → `404`
    - Sin base de datos: el adaptador Prisma se sustituye por el doble
    - _Requisitos: BP-R5.3, BP-R5.6, BP-R5.7, BP-R6.3, BP-R6.4_

- [x] 10. Documentación de la entrega
  - [x] 10.1 Escribir `apps/backend/README.md`
    - Secuencia exacta de puesta en marcha: `npm install`, build de `packages/shared`, copia de `.env.example`, `db:generate`, `db:migrate`, `db:seed`, `start`
    - Incluir la verificación manual de infraestructura (`migrate deploy` + `db:seed` sobre un archivo temporal), que no entra en la suite de Jest porque las pruebas corren sin base de datos
    - _Requisitos: BP-R2.8, BP-R6.1_

  - [x] 10.2 Documentar en `docs/arquitectura.md`
    - Sección de la extensión `INTERNAL_ERROR`: por qué la unión canónica de tres códigos no describe un fallo interno, por qué emitir `INVALID_CART` en un `500` sería mentirle al cliente y al log, y por qué la alternativa de una unión local del backend rompería la regla de contratos importados desde `packages/shared`
    - Las cuatro capas del backend (`http` → `application` → `domain` → `infra`) y el patrón Repository con las rutas concretas de los archivos
    - El trade-off de SQLite (concurrencia de escritura) y por qué queda detrás de `ProductRepository` y `OrderRepository`
    - Por qué los cupones no se persisten: el stock es estado mutable, el cupón es dato de referencia inmutable en este alcance (D3)
    - _Requisitos: BP-R5.7, BP-R4.3_

- [x] 11. Checkpoint final - Umbral de cobertura y scripts de la raíz
  - Ejecutar `npm run typecheck`, `npm run lint` y `npm run test:cov --workspace apps/backend`, verificando que el umbral del 80% en líneas y ramas se cumple y que el comando sale con código distinto de `0` cuando no
  - Verificar que `npm run test` y `npm run test:cov` de la raíz alcanzan `apps/backend` y propagan su fallo (BP-R6.7)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- **Ninguna subtarea es opcional.** Todo lo que quedó en el plan o entrega el endpoint o sostiene el
  umbral del 80%: `resolvePort`, `toProduct`, `sortByProductId`, `ApiExceptionFilter` y
  `seedProducts` son las únicas piezas con ramas, y sin sus pruebas el `coverageThreshold` rompe el
  comando.
- Cada tarea referencia sus criterios (`BP-Rx.y`) o el invariante del diseño que implementa.
- Alcance cerrado que las tareas respetan sin reabrir: sin adaptador Prisma de órdenes (D1), seed como
  script explícito que el arranque no ejecuta (D2), cupones en memoria sin modelo `Coupon` (D3), y
  adaptador Prisma, provider Prisma y bootstrap fuera de la medición de cobertura (D4).
- La tarea 1.2 hace fallar deliberadamente una prueba existente de `packages/shared`: es la señal de
  que `ERROR_CODES` es la única fuente de verdad de la unión.
- Verificaciones que deliberadamente **no** son tests: la pureza del dominio (regla de ESLint, no
  prueba de arquitectura), la exhaustividad de `Record<ErrorCode, number>` (la garantiza `tsc`), la
  ausencia de escrituras en el arranque (estructural, se demuestra en la demo) y el fallo de Nest
  ante un token no provisto (comportamiento del framework).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "3.1"] },
    { "id": 1, "tasks": ["1.2", "3.2", "4.1", "4.2", "4.3"] },
    { "id": 2, "tasks": ["3.3", "4.4", "5.1", "6.1", "6.5"] },
    { "id": 3, "tasks": ["3.4", "6.2", "6.3", "6.6"] },
    { "id": 4, "tasks": ["6.4", "8.1"] },
    { "id": 5, "tasks": ["8.2"] },
    { "id": 6, "tasks": ["8.3"] },
    { "id": 7, "tasks": ["8.4", "9.1"] },
    { "id": 8, "tasks": ["8.5"] },
    { "id": 9, "tasks": ["10.1", "10.2"] }
  ]
}
```
