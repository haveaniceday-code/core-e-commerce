# Requirements Document

## Introduction

Primera entrega de `apps/backend`: el arranque de NestJS, la persistencia real con Prisma sobre
SQLite, la migración inicial, el seed explícito del catálogo desde `@core/shared`, las interfaces
de repositorio en la capa de dominio con su adaptador Prisma en infraestructura, y el endpoint
`GET /api/products`.

Es la capa que convierte el catálogo canónico en datos persistidos y consultables. No calcula
descuentos ni procesa órdenes: publica el catálogo con su stock actual y deja instaladas las
costuras (repositorios, cliente Prisma, modelos de orden) sobre las que se apoya el checkout.

**Cadena de specs:** `monorepo-foundation` → `shared-contracts-seed` → `discount-engine` →
`backend-persistence`. Referencias entre specs con prefijo (`MF-`, `SCS-`, `DE-`, `BP-`); dentro
del documento, `R2.4` es "Requerimiento 2, criterio 4". Criterios en EARS.

**Hereda y no repite.** De `monorepo-foundation`: npm workspaces con `apps/*` y `packages/*`,
Node `>=20`, `strict: true`, cero `any` y cero assertions salvo `as const` —también en los dobles
de prueba—, y los scripts homogéneos por workspace. De `shared-contracts-seed`: `Product`,
`CartItem`, `ErrorCode`, `ApiError`, `CATALOG_PRODUCTS`, `findProductById`, `COUPONS`,
`findCouponByCode` y las utilidades de dinero. De `discount-engine`: `DiscountEngine`,
`DiscountStrategyFactory` y `DiscountDomainError`.

**Alcance acotado por decisión explícita:**

- `OrderRepository` entra solo como **interfaz de dominio** más los modelos `Order` y `OrderItem`
  en el schema y en la migración inicial. El adaptador Prisma de órdenes y sus pruebas de
  persistencia se postergan a la parte 2, junto con `POST /api/checkout`.
- Los cupones se resuelven **en memoria** desde `@core/shared`. No hay modelo `Coupon` en Prisma
  ni `CouponRepository` en esta entrega.
- El seed es un **script explícito**, no un efecto del arranque, para que un stock decrementado
  sobreviva al reinicio del proceso.

**Fuera de alcance:** `POST /api/checkout/preview`, `POST /api/checkout`, la validación de stock,
el decremento de stock, la persistencia de órdenes, y todo `apps/frontend`.

## Glossary

- **Backend_API**: la aplicación NestJS de `apps/backend`, montada bajo el prefijo global `/api`.
- **Controlador_Productos**: el controller HTTP que expone `GET /api/products`.
- **Servicio_Catalogo**: el servicio de caso de uso que obtiene el catálogo desde el repositorio.
- **Repositorio_Productos**: la interfaz de dominio `ProductRepository`.
- **Repositorio_Ordenes**: la interfaz de dominio `OrderRepository`.
- **Adaptador_Prisma_Productos**: la implementación de `Repositorio_Productos` sobre Prisma, en la
  capa de infraestructura.
- **Cliente_Prisma**: el `PrismaClient` expuesto como provider inyectable con ciclo de vida
  gestionado por Nest.
- **Schema_Prisma**: el archivo de schema de Prisma del backend, con su migración versionada.
- **Script_Seed**: el script de siembra invocable como `npm run db:seed`.
- **Suite_Backend**: la configuración y el conjunto de pruebas de Jest de `apps/backend`.
- **Paquete_Shared**: el paquete `@core/shared`, consumido únicamente por su entry público.

## Requirements

### Requerimiento 1: Arranque del backend NestJS

**User Story:** Como desarrollador, quiero un backend NestJS arrancable con tipado estricto y
validación en runtime, para tener una base sobre la que añadir endpoints sin reconfigurar nada.

#### Acceptance Criteria

1. EL Backend_API DEBERÁ arrancar desde un bootstrap propio que registre el prefijo global `api`,
   de modo que toda ruta declarada quede publicada bajo `/api`.
2. EL Backend_API DEBERÁ registrar un `ValidationPipe` global con `whitelist`,
   `forbidNonWhitelisted` y `transform` activos, para que los DTOs de entrada de los endpoints
   posteriores se validen en runtime con class-validator.
3. EL Backend_API DEBERÁ escuchar en el puerto tomado de la variable de entorno `PORT` cuando esa
   variable contiene un entero válido, y en `3000` en cualquier otro caso.
4. EL Backend_API DEBERÁ compilar con `strict: true`, `noImplicitAny: true` y
   `strictNullChecks: true` en su propio `tsconfig.json`, y `npm run typecheck --workspace
   apps/backend` DEBERÁ terminar sin errores.
5. EL Backend_API DEBERÁ importar del Paquete_Shared exclusivamente a través de su entry público
   `@core/shared`, sin rutas internas del paquete ni imports relativos hacia `packages/shared`.
6. EL Backend_API DEBERÁ exponer los scripts `build`, `start`, `typecheck`, `lint`, `test`,
   `test:cov` y `db:seed` en su `package.json`, de modo que los scripts agregadores de la raíz los
   alcancen.

### Requerimiento 2: Persistencia Prisma sobre SQLite

**User Story:** Como desarrollador, quiero el catálogo y las órdenes modelados en SQLite mediante
Prisma, para demostrar persistencia real y aprovechar los tipos generados por el ORM.

#### Acceptance Criteria

1. EL Schema_Prisma DEBERÁ declarar el datasource con provider `sqlite` y una URL tomada de la
   variable de entorno `DATABASE_URL`, apuntando a un archivo local del workspace del backend.
2. EL Schema_Prisma DEBERÁ declarar el modelo de producto con `id` como clave primaria de tipo
   texto, `name` texto, `category` texto, `priceCents` entero y `stock` entero, todos requeridos,
   de forma que cada fila satisfaga el contrato `Product` del Paquete_Shared.
3. EL Schema_Prisma DEBERÁ declarar los modelos de orden y de línea de orden con montos en
   centavos enteros, la relación de la línea hacia su orden y hacia el producto, la cantidad como
   entero, y una marca temporal de creación, quedando disponibles para la parte 2 sin adaptador en
   esta entrega.
4. EL Schema_Prisma DEBERÁ omitir todo modelo de cupón, porque los cupones se resuelven en memoria
   desde el Paquete_Shared.
5. EL Backend_API DEBERÁ incluir una migración inicial versionada que cree las tres tablas
   —producto, orden y línea de orden— de manera que `prisma migrate deploy` sobre una base vacía
   deje el esquema completo.
6. EL Backend_API DEBERÁ exponer el Cliente_Prisma como provider inyectable que conecta al
   inicializarse el módulo y desconecta al cerrarse la aplicación, y DEBERÁ ser el único punto del
   backend que instancia `PrismaClient`.
7. EL Backend_API DEBERÁ mantener el archivo `.db`, sus copias auxiliares y los artefactos
   generados del cliente fuera del control de versiones mediante entradas de `.gitignore`, de modo
   que un clon limpio reconstruya la base con la migración y el Script_Seed.
8. EL Backend_API DEBERÁ documentar en su `README` o en sus scripts la secuencia de puesta en
   marcha —generar cliente, aplicar migración, sembrar— con los comandos exactos.

### Requerimiento 3: Seed explícito del catálogo

**User Story:** Como desarrollador, quiero sembrar el catálogo con un comando explícito, para que
el stock modificado por una compra sobreviva al reinicio del backend.

#### Acceptance Criteria

1. EL Script_Seed DEBERÁ tomar los productos desde `CATALOG_PRODUCTS` del Paquete_Shared, sin
   redeclarar ids, nombres, categorías, precios ni stock en el backend.
2. EL Script_Seed DEBERÁ escribir cada producto con una operación de upsert por `id`, de modo que
   dos ejecuciones consecutivas dejen exactamente las mismas filas, con la misma cantidad de
   registros y sin claves duplicadas.
3. EL Script_Seed DEBERÁ quedar invocable como `npm run db:seed --workspace apps/backend` y estar
   registrado como el seed de Prisma, para que `prisma db seed` ejecute el mismo código.
4. CUANDO EL Script_Seed termina correctamente, DEBERÁ salir con código `0` e informar la cantidad
   de productos escritos.
5. SI EL Script_Seed falla al conectar con la base o al escribir una fila, ENTONCES DEBERÁ salir
   con código distinto de `0` y describir el fallo, de modo que un pipeline lo detecte.
6. EL Backend_API DEBERÁ dejar los datos existentes intactos durante el arranque, sin ejecutar
   siembra, reescritura ni restauración de stock, de modo que un `stock` decrementado conserve su
   valor tras reiniciar el proceso.

### Requerimiento 4: Repositorios como interfaces de dominio

**User Story:** Como desarrollador, quiero el acceso a datos detrás de interfaces de dominio, para
que la lógica de caso de uso no dependa de Prisma y los tests usen dobles en memoria.

#### Acceptance Criteria

1. EL Repositorio_Productos DEBERÁ declararse en la capa de dominio del backend como interfaz que
   expone la obtención del catálogo completo y la búsqueda por `id`, con firmas expresadas en
   términos del contrato `Product` del Paquete_Shared.
2. EL Repositorio_Ordenes DEBERÁ declararse en la capa de dominio del backend como interfaz que
   expone la creación de una orden con sus líneas y montos en centavos enteros, quedando sin
   implementación concreta en esta entrega por decisión de alcance.
3. LA capa de dominio del backend DEBERÁ mantenerse libre de imports de Prisma, de NestJS y de
   HTTP, de modo que las interfaces sean implementables por cualquier adaptador. La restricción se
   verifica con una regla `no-restricted-imports` de ESLint acotada a `src/domain`, que rompe
   `npm run lint`, y no con una prueba de arquitectura en tiempo de ejecución.
4. EL Backend_API DEBERÁ resolver el Repositorio_Productos por un token de inyección estable, de
   modo que un test sustituya la implementación sin modificar al Servicio_Catalogo.
5. EL Adaptador_Prisma_Productos DEBERÁ implementar el Repositorio_Productos consultando mediante
   el Cliente_Prisma y mapeando cada fila a `Product` con `category` estrechada a
   `ProductCategory` mediante una comprobación en runtime contra `PRODUCT_CATEGORIES`, sin
   assertions de tipo.
6. CUANDO la búsqueda por `id` no encuentra fila, EL Adaptador_Prisma_Productos DEBERÁ devolver un
   valor tipado de ausencia, sin lanzar excepción.
7. SI una fila persistida contiene una `category` ajena a `PRODUCT_CATEGORIES`, ENTONCES EL
   Adaptador_Prisma_Productos DEBERÁ fallar con un error tipado que identifique el `id` y el valor
   inválido, de modo que el dato corrupto quede visible en lugar de propagarse como categoría
   silenciosamente inaplicable.

### Requerimiento 5: Endpoint GET /api/products

**User Story:** Como cliente del carrito, quiero consultar el catálogo con su stock actual, para
listar productos disponibles y sus precios.

#### Acceptance Criteria

1. EL Controlador_Productos DEBERÁ exponer `GET /api/products` delegando en una única llamada al
   Servicio_Catalogo, sin consultar el Cliente_Prisma, sin mapear filas y sin contener reglas de
   negocio.
2. EL Servicio_Catalogo DEBERÁ obtener el catálogo a través del Repositorio_Productos y devolverlo
   como `readonly Product[]`, tipado con el contrato del Paquete_Shared.
3. CUANDO EL Backend_API atiende `GET /api/products` con el catálogo sembrado, DEBERÁ responder
   `200` con un arreglo JSON de seis elementos, cada uno con exactamente las claves `id`, `name`,
   `category`, `priceCents` y `stock`, y con los valores idénticos a `CATALOG_PRODUCTS`.
4. EL Backend_API DEBERÁ emitir `priceCents` y `stock` como enteros JSON y `category` como el
   literal sin tilde —`Tecnologia`, `Hogar` o `Ropa`—, dejando la etiqueta con tilde
   (`CATEGORY_LABEL`) para la capa de presentación.
5. EL Backend_API DEBERÁ devolver los productos en orden ascendente por `id`, de modo que la
   respuesta sea determinista entre peticiones.
6. CUANDO la tabla de productos está vacía, EL Backend_API DEBERÁ responder `200` con un arreglo
   vacío, sin lanzar excepción.
7. SI la consulta al Repositorio_Productos falla, ENTONCES EL Backend_API DEBERÁ responder `500`
   con un cuerpo que respete la forma `ApiError`, con un mensaje genérico y sin exponer la
   consulta, la ruta del archivo de base de datos ni la traza interna.

### Requerimiento 6: Pruebas y umbral de cobertura del backend

**User Story:** Como desarrollador, quiero pruebas con dobles tipados y un umbral que rompa el
comando, para que la cobertura del backend sea una condición verificada y no una aspiración.

#### Acceptance Criteria

1. LA Suite_Backend DEBERÁ ejecutarse con Jest mediante `npm run test --workspace apps/backend`
   sin requerir base de datos, servidor externo ni variables de entorno adicionales para las
   pruebas unitarias.
2. LA Suite_Backend DEBERÁ probar al Servicio_Catalogo y al Controlador_Productos con dobles en
   memoria que implementen el Repositorio_Productos con tipado completo, sin `any`, sin assertions
   de tipo y sin `@ts-ignore`.
3. LA Suite_Backend DEBERÁ cubrir el catálogo sembrado, el catálogo vacío y el fallo del
   repositorio, verificando en el último caso el estado `500` y la forma `ApiError` de `R5.7`.
   DEBERÁ además cubrir con pruebas por ejemplo la resolución del puerto, el mapeo de fila a
   `Product` con su caso de categoría corrupta, el orden determinista del catálogo y la
   idempotencia de la siembra, por ser las únicas piezas con ramas de esta entrega.
4. LA Suite_Backend DEBERÁ incluir una prueba end-to-end que arranque el módulo de Nest con un
   Repositorio_Productos en memoria y consulte `GET /api/products` con supertest, afirmando el
   estado `200`, el cuerpo JSON del catálogo y que la ruta sin el prefijo `/api` responde `404`.
5. LA Suite_Backend DEBERÁ configurar `coverageThreshold` en `80` por ciento de líneas y de ramas,
   y `npm run test:cov --workspace apps/backend` DEBERÁ salir con código distinto de `0` cuando
   cualquiera de los dos porcentajes queda por debajo.
6. LA Suite_Backend DEBERÁ excluir de la medición de cobertura al Adaptador_Prisma_Productos, al
   provider del Cliente_Prisma y al bootstrap. La exclusión del adaptador se sostiene en que la
   lógica no vive dentro de él: el mapeo de fila a `Product` reside en la capa de dominio
   (`product-mapper.ts`), que sí se mide, y el adaptador queda reducido a una consulta y una
   delegación. NO se sostiene en la prueba end-to-end: esa prueba sustituye el repositorio por un
   doble en memoria (`R6.4`) y por tanto nunca ejecuta el adaptador.
7. EL Backend_API DEBERÁ quedar alcanzado por los scripts `test` y `test:cov` de la raíz, de modo
   que `npm run test:cov` en la raíz falle cuando el umbral del backend no se cumple.
