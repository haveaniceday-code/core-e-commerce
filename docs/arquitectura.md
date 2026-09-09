# Arquitectura

Documento de decisiones de arquitectura del monorepo. Crece por entrega: cada spec añade la
sección de lo que instaló, con el fundamento de la decisión y no solo su enunciado.

Esta versión cubre `apps/backend` tal como lo dejó la spec `backend-persistence`: el arranque de
NestJS, la persistencia Prisma sobre SQLite, el seed explícito del catálogo, los repositorios como
puertos de dominio y el endpoint `GET /api/products`.

---

## Las cuatro capas de `apps/backend`

El backend se organiza en cuatro capas con una única dirección de dependencia permitida:

```
HTTP  ──► http/          orquesta: recibe, delega, responde. Cero reglas.
            │
            ▼
         application/    caso de uso: pide el catálogo al puerto.
            │
            ▼            (token de inyección, no clase concreta)
         domain/         puertos, mapeo puro, errores tipados.
            ▲
            │ implements
         infra/prisma/   adaptador: consulta y delegación.
```

Rutas concretas:

| capa | archivos |
|------|----------|
| `http` | `apps/backend/src/http/products.controller.ts`, `apps/backend/src/http/api-exception.filter.ts`, `apps/backend/src/http/products.module.ts` |
| `application` | `apps/backend/src/application/catalog.service.ts` |
| `domain` | `apps/backend/src/domain/tokens.ts`, `product.repository.ts`, `order.repository.ts`, `product-mapper.ts`, `product-order.ts`, `errors.ts` |
| `infra` | `apps/backend/src/infra/prisma/prisma.service.ts`, `prisma.module.ts`, `prisma-product.repository.ts` |
| arranque | `apps/backend/src/main.ts` (bootstrap), `apps/backend/src/port.ts` (`resolvePort`), `apps/backend/src/app.module.ts` |

La flecha que sostiene el diseño es la última, la que va hacia arriba: `application` depende de la
**interfaz** de dominio resuelta por token, y es `infra` quien depende del dominio. Invertida esa
dependencia, `CatalogService` tendría que importar `PrismaProductRepository` y no habría forma de
probarlo sin base de datos.

`main.ts` y `port.ts` están separados a propósito. El bootstrap queda fuera de la medición de
cobertura por ser código de proceso, pero la resolución del puerto sí tiene ramas —`undefined`,
cadena vacía, no numérico, no entero, fuera de rango— y merece prueba. Extraerla a una función pura
es lo que permite excluir el bootstrap sin dejar lógica sin verificar.

`product-mapper.ts` vive en `domain` y no en `infra` por la misma razón: recibe una fila
**estructural** (`PersistedProductRow`), no un tipo generado por Prisma. El modelo de Prisma la
satisface estructuralmente, así que el adaptador la pasa sin conversión y el dominio no importa
`@prisma/client`. El efecto es que el único fragmento de lógica no trivial de la entrega —el
estrechamiento de `category` a `ProductCategory` con un type guard sobre `PRODUCT_CATEGORIES`, sin
assertions— queda del lado medido y probado, y el adaptador queda reducido a una consulta y una
delegación.

### La pureza del dominio se impone en el linter, no en un test

`domain/` no importa Prisma, NestJS, `express`, `src/infra` ni `src/http`. Esa restricción no se
verifica con una prueba de arquitectura que recorra imports en runtime, sino con una regla
`no-restricted-imports` acotada a `src/domain/**/*.ts` en `apps/backend/eslint.config.mjs`, que
rompe `npm run lint`.

El criterio es cuándo falla la verificación: la regla de ESLint falla al escribir el import, antes
de compilar; el test de arquitectura falla al ejecutar la suite, mucho después, y hay que
mantenerlo. Para una propiedad que es puramente sintáctica —qué módulos aparecen en la cabecera de
un archivo— el linter es la herramienta correcta.

## Patrón Repository: puertos en el dominio, adaptador en infraestructura

Las interfaces se declaran en la capa de dominio y las implementa infraestructura:

- `apps/backend/src/domain/product.repository.ts` — `ProductRepository`, con `findAll()` y
  `findById(id)`. El orden ascendente por `id` es parte del contrato de la interfaz, no un detalle
  del `orderBy` de Prisma: si viviera solo en el adaptador, un doble de prueba podría devolver otro
  orden y el e2e pasaría afirmando algo que producción no garantiza.
- `apps/backend/src/domain/order.repository.ts` — `OrderRepository` más `NewOrder`, `NewOrderLine`
  y `PersistedOrder`. Declarado sin implementación concreta en esta entrega por decisión de alcance
  (D1): el adaptador de órdenes llega con `POST /api/checkout`. Se escribe ahora porque fija la
  forma de la orden persistida que el schema ya modela, y porque tener el puerto declarado es lo
  que permite que el checkout llegue después sin tocar `application` ni `http`.
- `apps/backend/src/infra/prisma/prisma-product.repository.ts` — la implementación sobre Prisma.
  Convierte el `null` de Prisma a `undefined` aquí y no más arriba, porque el dominio expresa
  ausencia con `undefined`, igual que `findProductById` de `@core/shared`.

La resolución va por token estable (`PRODUCT_REPOSITORY` en `apps/backend/src/domain/tokens.ts`),
con el binding declarado en un único lugar, `apps/backend/src/http/products.module.ts`. Eso es lo
que hace que `apps/backend/test/products.e2e-spec.ts` arranque el módulo de Nest con
`overrideProvider(PRODUCT_REPOSITORY)` y el doble de
`apps/backend/test/doubles/in-memory-product.repository.ts`, sin base de datos y sin modificar
`CatalogService`. La prueba de que el desacoplamiento es real es que la suite completa corre sin un
archivo `.db`.

## La extensión `INTERNAL_ERROR` del contrato de error

`packages/shared` es dueño único del contrato de error. Su unión canónica tenía tres miembros, y
cada uno describe un problema del **cliente**:

| código | estado | qué describe |
|--------|--------|--------------|
| `INSUFFICIENT_STOCK` | 409 | el carrito pide más unidades de las que hay |
| `PRODUCT_NOT_FOUND` | 404 | el carrito referencia un producto que no existe |
| `INVALID_CART` | 400 | el carrito enviado está mal formado |

Ninguno describe un fallo interno del servidor. Y el backend necesita uno: si la consulta al
repositorio falla, si SQLite no está disponible, o si una fila persistida trae una `category` ajena
a `PRODUCT_CATEGORIES`, la respuesta es un `500` cuyo cuerpo debe respetar la forma `ApiError`, y
`ApiError.error.code` está tipado como `ErrorCode`.

Se consideraron tres caminos.

**Reutilizar `INVALID_CART` en el 500** es mentir en dos direcciones a la vez. Al cliente, porque
el frontend recibiría un código de error de entrada ante una caída de infraestructura: la reacción
correcta a `INVALID_CART` es revisar el carrito y reintentar corregido, y ante SQLite caído eso no
arregla nada y además culpa al usuario de un fallo que no cometió. Y al log, porque el operador que
abre la traza buscaría un carrito inválido que nunca existió, perdiendo tiempo en el lugar
equivocado mientras la base sigue caída. Un código de error es un contrato semántico, y aquí el
tipo cuadra pero el significado no: es exactamente la clase de fallo que el compilador no puede
detectar.

**Declarar una unión local en el backend** —un `BackendErrorCode = ErrorCode | 'INTERNAL_ERROR'`—
tipa sin mentir, pero rompe la regla de que las respuestas de la API usan contratos explícitos
importados desde `packages/shared`. El daño concreto es que el frontend importa `ErrorCode` desde
el paquete compartido para decidir cómo reacciona a cada fallo; con la unión partida, el backend
podría emitir un código que el cliente no tiene declarado, y el `switch` exhaustivo del frontend
dejaría de serlo sin que nada lo señale. Dos fuentes de verdad para un mismo contrato es
precisamente lo que el monorepo existe para evitar.

**La decisión: añadir `'INTERNAL_ERROR'` a `ERROR_CODES`** en
`packages/shared/src/domain/errors.ts`. Es un cambio aditivo de una línea sobre el arreglo
`as const`, así que `ErrorCode` lo deriva sin redeclarar la unión, y está marcado en el código como
extensión de infraestructura ajena al enunciado, en la misma línea en que `DEMOCAP50` está marcado
como extensión de demo. El mapeo a `500` vive en el `Record<ErrorCode, number>` de
`apps/backend/src/http/api-exception.filter.ts`, que al ser exhaustivo hace que **el compilador**
sea quien exija un estado HTTP para cualquier código futuro.

El saneamiento del `500` es estructural, no defensivo: el cuerpo que sale al cliente es una
constante, no una derivación del error capturado. No existe camino por el que el mensaje original,
la consulta SQL, la ruta del archivo `.db` o la traza lleguen al cliente, mientras
`logger.error` sí recibe la excepción completa del lado servidor. El `id` y el valor inválido de
una fila corrupta (`CorruptProductRowError`, en `apps/backend/src/domain/errors.ts`) viajan al log
y a ningún otro sitio.

## SQLite: el trade-off y por qué no se filtra a la lógica

SQLite se eligió por persistencia real y demostrable: se reinicia el backend y la orden sigue ahí,
con un stock decrementado que conserva su valor. Es lo que la persistencia en memoria no permite, y
es la razón por la que el seed es un script explícito (`apps/backend/prisma/seed.ts`, invocable con
`npm run db:seed`) y no un efecto del arranque. Un seed en el bootstrap restauraría el catálogo
canónico en cada reinicio y borraría justo la evidencia que se quiere mostrar.

El trade-off es la concurrencia de escritura. SQLite serializa los escritores: bajo escrituras
simultáneas —dos checkouts compitiendo por el mismo stock— la segunda transacción espera o falla
con un error de base bloqueada. No hay concurrencia de escritura seria y no la va a haber. Para
este alcance es irrelevante, pero es una limitación real y no se disimula.

Lo que hace que el trade-off sea asumible es que la elección de motor no es una decisión
estructural: el acceso a datos está detrás de `ProductRepository` y `OrderRepository`, declarados en
`apps/backend/src/domain/`, y el único punto del backend que instancia `PrismaClient` es
`apps/backend/src/infra/prisma/prisma.service.ts`. Migrar a PostgreSQL toca el datasource del
schema, la migración y el adaptador; no toca el dominio, ni el caso de uso, ni el controlador, ni un
solo test unitario, porque ninguno de ellos sabe qué motor hay debajo. El coste de revertir esta
decisión está acotado por construcción, y eso es lo que autoriza a tomarla rápido.

## Por qué los cupones no se persisten

No hay modelo `Coupon` en el schema ni `CouponRepository` en el dominio. Los cupones se resuelven
en memoria desde `@core/shared`, con `COUPONS` y `findCouponByCode` (D3).

El criterio es la mutabilidad, no la comodidad. El **stock es estado**: cambia con cada checkout, su
valor actual es resultado de la historia de transacciones y perderlo al reiniciar el proceso
destruye información que nadie puede reconstruir. Por eso vive en la base. El **cupón es dato de
referencia**: en este alcance su código, su tasa y su vigencia son constantes del catálogo, y no
existe ningún camino en la aplicación que los modifique. Persistir un dato inmutable no aporta
durabilidad —no hay nada que perder— y sí añade una tabla, una migración, un adaptador, sus pruebas
y una segunda fuente de verdad que puede divergir de `packages/shared`.

Hay además una consecuencia que refuerza la decisión: `DEMOCAP50` está marcado como extensión de
demo en el código compartido, donde la marca es visible junto a su definición. En una fila de SQLite
esa marca se convertiría en una columna booleana o en un comentario perdido en el seed, y el cupón
de demo pasaría a ser indistinguible de los del enunciado.

Cuando los cupones dejen de ser inmutables —una fecha de expiración administrable, un contador de
usos— la decisión cambia, y cambia en un solo sitio: se declara `CouponRepository` como puerto de
dominio y su adaptador en infraestructura, exactamente como está hecho para productos. El motor de
descuentos no se entera, porque recibe el cupón ya resuelto y no sabe de dónde viene.
