# Arquitectura

Documento de decisiones de arquitectura del monorepo. Crece por entrega: cada spec añade la
sección de lo que instaló, con el fundamento de la decisión y no solo su enunciado.

Esta versión cubre el monorepo completo: `packages/shared` con el motor de descuentos,
`apps/backend` —arranque de NestJS, persistencia Prisma sobre SQLite, seed explícito, repositorios
como puertos de dominio, `GET /api/products`, `POST /api/checkout/preview`, `POST /api/checkout`,
las reglas puras de stock y el puerto de confirmación de compra— y `apps/frontend`, con el carrito
reactivo, el cupón, el desglose, la alerta del tope y la confirmación de la orden.

---

## Las cuatro capas de `apps/backend`

El backend se organiza en cuatro capas con una única dirección de dependencia permitida:

```
HTTP  ──► http/          orquesta: recibe, delega, responde. Cero reglas.
            │
            ▼
         application/    caso de uso: pide el catálogo, invoca el motor, confirma.
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
| `http` | `apps/backend/src/http/products.controller.ts`, `checkout.controller.ts`, `checkout.dto.ts`, `api-exception.filter.ts`, `products.module.ts`, `checkout.module.ts` |
| `application` | `apps/backend/src/application/catalog.service.ts`, `checkout.service.ts` |
| `domain` | `apps/backend/src/domain/tokens.ts`, `product.repository.ts`, `purchase.port.ts`, `order.repository.ts`, `stock.ts`, `product-mapper.ts`, `product-order.ts`, `errors.ts` |
| `infra` | `apps/backend/src/infra/prisma/prisma.service.ts`, `prisma.module.ts`, `prisma-product.repository.ts`, `prisma-purchase.repository.ts` |
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
- `apps/backend/src/domain/order.repository.ts` — hoy solo `NewOrder`, `NewOrderLine` y
  `PersistedOrder`. La interfaz `OrderRepository` que daba nombre al archivo se declaró en
  `backend-persistence` sin implementación, y `backend-checkout` la **eliminó**: quedó subsumida por
  `PurchaseConfirmationPort` (ver la sección siguiente). Los tipos se conservan intactos, porque son
  la forma de la orden que el schema ya modela y la que el puerto recibe y devuelve.
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

## Ports & Adapters: `PurchaseConfirmationPort` tiene una operación, no dos

El puerto de confirmación de compra se declara en `apps/backend/src/domain/purchase.port.ts` con un
único método:

```ts
confirm(order: NewOrder): Promise<PersistedOrder>;
```

Que sea **uno** y no dos es la decisión, y no una simplificación. El decremento de stock y la
creación de la orden son una unidad atómica: o pasan las dos cosas o no pasa ninguna. Con la interfaz
partida en `decrementStock` y `create`, el segundo método tendría que ejecutarse dentro de la misma
transacción que el primero, y la única forma de conseguirlo es que reciba el cliente transaccional
por parámetro. Eso pone un tipo de Prisma en la firma de una interfaz de dominio, que es exactamente
la dependencia que el puerto existe para evitar. La atomicidad no es un detalle del adaptador que
pueda quedar fuera del contrato: es la garantía que el contrato ofrece, así que tiene que caber en
una sola llamada.

De ahí que `OrderRepository` desapareciera junto con su token `ORDER_REPOSITORY`. No fue un
renombrado: el puerto la subsume. Retirarla no costó nada porque nunca tuvo consumidor —se había
declarado en `backend-persistence` anticipando el checkout—, y conservarla habría dejado dos maneras
de escribir una orden, una de ellas incapaz de ser atómica. La diferencia con `ProductRepository` es
de naturaleza, no de tamaño: un repositorio es una colección persistida y se nombra por su entidad;
este puerto se nombra por el hecho de negocio que confirma, y su interfaz es la de un caso de uso
porque lo que garantiza es una unidad de trabajo.

El reparto de responsabilidades queda así:

| pieza | archivo | qué decide |
|-------|---------|------------|
| puerto | `apps/backend/src/domain/purchase.port.ts` | nada: declara la garantía |
| adaptador | `apps/backend/src/infra/prisma/prisma-purchase.repository.ts` | **cómo** se consigue la atomicidad |
| binding | `apps/backend/src/http/checkout.module.ts` (`PURCHASE_PORT`) | qué implementación se usa |
| caso de uso | `apps/backend/src/application/checkout.service.ts` | la secuencia de la compra |

`CheckoutService` recibe el puerto por token y no conoce ni la transacción ni el motor de base. Es lo
que permite que `apps/backend/test/doubles/in-memory-purchase.port.ts` lo sustituya y que toda la
suite del checkout —unitaria y e2e— corra sin un archivo `.db`.

## El compare-and-swap no depende del nivel de aislamiento

Dentro de `$transaction`, cada línea se decrementa con una actualización **condicional**:

```ts
tx.product.updateMany({
  where: { id: line.productId, stock: { gte: line.quantity } },
  data: { stock: { decrement: line.quantity } },
});
```

Dos propiedades sostienen la corrección, y ninguna es una garantía que haya que pedirle al motor:

- **La condición y la escritura son la misma sentencia.** No hay ventana entre comprobar el stock y
  restarlo porque no se comprueba por separado: si otra transacción se llevó las unidades, la fila
  deja de satisfacer el `where` y `count` vale `0`.
- **`decrement` es atómico.** Se traduce a `SET stock = stock - ?`, no a un leer-modificar-escribir
  en el proceso Node.

Por eso el nivel de aislamiento es irrelevante aquí. La anomalía clásica del inventario es la
actualización perdida, y una actualización perdida necesita una lectura cuyo resultado se use para
calcular la escritura: `SELECT stock`, decidir en el proceso, `UPDATE stock = 4`. Ese patrón sí
depende de que el motor impida que otro escritor se cuele en medio, y por tanto del aislamiento. Aquí
no hay lectura: la escritura se calcula sola y su precondición la evalúa el motor mientras tiene la
fila tomada. El código sería igual de correcto sobre PostgreSQL con `READ COMMITTED`, que es lo
importante: **no** está apoyado en la serialización de escritores de SQLite, solo la tolera.

Cuando alguna actualización no afecta fila, `verifyStockDecrements` lanza
`DiscountDomainError('INSUFFICIENT_STOCK', …)` desde dentro del callback, lo que aborta la
transacción completa: los decrementos ya emitidos se revierten y la orden no llega a crearse. No
queda estado intermedio que limpiar.

Esa guarda vive en `apps/backend/src/domain/stock.ts` y no en el adaptador, por el mismo criterio que
puso `product-mapper.ts` en el dominio. Es una función pura sobre `StockDecrementOutcome[]`, un tipo
estructural que el adaptador rellena con los `count` que devuelve Prisma. Dentro del adaptador no
podría probarse sin doblar el cliente transaccional, y quedaría fuera de la medición de cobertura.
Fuera, se prueba con una tabla de casos y con el modo de fallo del doble en memoria, que devuelve
`affectedRows: 0` en una línea y permite ejercitar una carrera sin base de datos. El adaptador queda
reducido a emitir las sentencias y delegar el veredicto: no decide nada.

### Por qué la validación previa sigue existiendo

`CheckoutService.confirm` comprueba el stock antes de escribir, con `normalizeCart` y `findShortages`.
Para la **corrección** es redundante: la guarda del compare-and-swap ya hace imposible vender más
unidades de las que hay. Se mantiene porque las dos comprobaciones responden preguntas distintas.

| | validación previa | guarda del decremento |
|---|---|---|
| dónde | `checkout.service.ts`, paso 4 | `stock.ts`, dentro de la transacción |
| a quién sirve | al usuario | al sistema |
| qué sabe | cuánto se pidió y cuánto había | que la fila ya no cumplía la condición |
| detalles del `409` | `shortages`, con `requested` y `available` de **todas** las líneas deficitarias | `contendedProductIds` |

La validación previa informa: reporta todas las líneas en déficit con sus cantidades, de modo que el
carrito se corrija en un solo intento. La guarda protege: sabe que perdió la carrera, pero no cuánto
stock quedaba —y releerlo daría un valor igual de obsoleto—, así que no puede prometer un `available`
que ya no sería cierto. Por eso sus detalles son distintos, y por eso los dos `409` no son el mismo
error con dos redacciones.

Quedarse solo con la guarda convertiría todo carrito excedido en un mensaje opaco de carrera, y
pagaría una transacción por cada rechazo que se podía conocer sin escribir. Quedarse solo con la
validación reabriría la ventana entre comprobar y escribir. Y el orden en que están —validar y
calcular primero, escribir después— es lo que hace que un checkout rechazado **no llegue a tocar la
base por construcción**, no por rollback. El rollback cubriría el caso igualmente; que sea cierto sin
necesidad de deshacer nada es lo que permite afirmarlo en una prueba unitaria sin base de datos.

## Por qué `preview` y `checkout` no pueden divergir

Los dos endpoints exponen el mismo desglose, y el riesgo evidente es que uno de ellos empiece a
calcularlo distinto: un redondeo aplicado en otro punto, un umbral copiado, un total recompuesto. La
respuesta no es una convención ni un test de regresión, sino que **no hay dos implementaciones**.

- **Un solo motor.** `CheckoutService` guarda una instancia,
  `new DiscountEngine(new DiscountStrategyFactory().create())`, y tanto `preview` como `confirm`
  llaman a `engine.calculate`. No hay una segunda construcción del motor en el backend.
- **Una sola forma de armar la entrada.** El helper `toCalculationInput` es compartido por los dos
  métodos. Si cada uno compusiera su propio contexto, la divergencia estaría a una edición de
  distancia.
- **Un solo redondeo, y no vive aquí.** El servicio no redeclara tasas, umbrales, precedencia ni el
  tope, y no ejecuta ninguna operación de redondeo sobre montos calculados: `MICRO` y `roundHalfUp`
  son de `packages/shared`, que es dueño único de la política. La cascada exacta en micro-centavos y
  el redondeo único final ocurren en el mismo código para ambos caminos.
- **Los precios son los persistidos en los dos casos.** Ambos métodos leen el catálogo del
  `ProductRepository`. La petición aporta únicamente líneas y cupón: `checkout.dto.ts` no declara
  ningún campo de monto, y `forbidNonWhitelisted` rechaza los ajenos, así que no existe canal por el
  que el cliente pueda influir en los importes.
- **La confirmación embebe los totales, no los recalcula.** `toOrderConfirmation` recibe el
  `CheckoutTotals` que produjo el motor y con el que se persistió la orden, y lo pasa tal cual. No
  hay una segunda derivación que pueda diferir en un centavo.

`checkout.service.spec.ts` afirma la igualdad campo por campo entre `preview` y `confirm` para el
mismo carrito y cupón. Conviene ser preciso sobre qué hace ese test: documenta la propiedad y avisa
si alguien introduce un camino paralelo, pero no es lo que la sostiene. Lo que la sostiene es que
divergir exigiría editar `packages/shared`, y eso cambia los dos lados a la vez.

## Una excepción medida: el adaptador de compra sí entra en cobertura

`prisma-product.repository.ts` está excluido de la medición en `apps/backend/jest.config.ts` porque
es una consulta y una delegación, sin ramas propias: medirlo solo añadiría ruido. El mismo criterio
se anticipó para `prisma-purchase.repository.ts` una vez extraída la guarda del compare-and-swap al
dominio, y **no se cumplió**. Queda una rama: `order.couponCode ?? null`.

Es una frontera de representación y no una decisión de negocio —el dominio expresa "sin cupón" con la
propiedad ausente y la columna lo expresa con `NULL`—, así que había un argumento para excluirlo
igualmente. Se descartó: el criterio es sintáctico y se aplica tal cual, si el archivo tiene ramas se
mide. El coste de la alternativa es peor que la asimetría, porque una lista de exclusiones que
depende de juzgar si una rama "cuenta" deja de ser verificable y se convierte en una discusión caso
por caso.

El resultado es que los dos adaptadores Prisma se tratan distinto, y esa asimetría no es elegante. Se
documenta en el propio `jest.config.ts`, junto a la exclusión, para que quien la lea entienda que es
una consecuencia del criterio y no un olvido.

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

Conviene separar esa limitación de la corrección del checkout, porque es fácil confundirlas. El
decremento condicional descrito arriba no está apoyado en que SQLite serialice a los escritores: es
correcto sobre un motor concurrente igual que sobre este. La serialización es un techo de
rendimiento, no el mecanismo que evita la sobreventa.

Lo que hace que el trade-off sea asumible es que la elección de motor no es una decisión
estructural: el acceso a datos está detrás de `ProductRepository` y `PurchaseConfirmationPort`,
declarados en `apps/backend/src/domain/`, y el único punto del backend que instancia `PrismaClient` es
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

---

## Por qué el frontend no calcula nada

`apps/frontend` es React con Vite y Zustand. La decisión que lo define no es el stack sino lo que
**no** hace: no calcula descuentos, no redondea, no compone etiquetas y no deduce si el tope se
activó. Pide `POST /api/checkout/preview` y pinta los enteros que llegan.

La razón es la que ya justifica la política de redondeo del motor: si el frontend recalculara la
cascada tendría que reimplementar los micro-centavos, las tasas en puntos básicos y el reparto por
mayor resto. Dos implementaciones de la misma regla divergen, y el síntoma clásico es el descuadre
de un centavo entre lo que el usuario vio en pantalla y lo que quedó persistido en la orden. Con
una sola implementación en `packages/shared` y el frontend limitado a formatear, esa divergencia es
**estructuralmente imposible**, no una convención que alguien deba recordar.

La única aritmética de dinero que sobrevive en el cliente es el subtotal optimista del carrito:

```ts
selectCartLines(state).reduce((acc, l) => acc + l.product.priceCents * l.quantity, 0)
```

Producto de enteros, exacto, sin redondeo y sin punto flotante. Se permite porque no hay ninguna
fracción que redondear, y existe para que agregar un producto se sienta instantáneo sin esperar al
servidor. El desglose de descuentos, en cambio, siempre viene del backend.

### El store no guarda precios

`items` es `Record<string, number>`: identificador de producto y cantidad, nada más. El precio, el
nombre y la categoría se resuelven contra el catálogo en el momento de leer.

Si la línea del carrito llevara su propio `priceCents` habría dos copias del precio —la del catálogo
y la de la línea— que divergen en cuanto el catálogo se recargue tras una compra. Guardando solo la
cantidad, el precio tiene una sola fuente y el problema no puede existir.

Por el mismo motivo el subtotal es un **selector derivado** y no un campo del estado: un
`subtotalCents` almacenado sería un segundo lugar que mantener sincronizado con `items`, y el primer
bug sería un subtotal viejo tras un `remove`.

### Validación en la frontera de red, no assertions

`Response.json()` devuelve `Promise<any>`, y las reglas de tipado del proyecto prohíben tanto `any`
como las type assertions. La salida fácil —`(await response.json()) as readonly Product[]`— se
descartó: una assertion sobre datos que vienen de fuera del proceso no verifica nada, solo silencia
al compilador exactamente donde hace falta comprobar.

El cuerpo entra como `unknown` —la única conversión que no necesita assertion— y se estrecha con
predicados de tipo (`isProduct`, `isCatalog`, `isApiError`). La respuesta queda **validada** en el
borde en lugar de asumida, y `apps/frontend` no contiene una sola assertion.

Es el mismo criterio que `toProduct` aplica en el backend sobre las filas de Prisma: en toda
frontera donde el dato deja de estar bajo el control del compilador, se comprueba en runtime.

### La alerta del tope se lee, no se deduce

`CapAlert` se renderiza si y solo si `totals.capApplied` es `true`. No compara `totalSavingsCents`
con `capCents` ni `effectiveDiscountBps` con `3500`, y la diferencia no es estilística: **un
descuento de exactamente el 35% no dispara la alerta**, porque el tope solo se considera aplicado
cuando hubo truncamiento real. Las dos derivaciones por comparación no saben distinguir ese caso
de frontera; el booleano que decide el backend sí.

Por eso la prueba verifica la alerta en las dos direcciones —presente con `capApplied: true`,
ausente con `capApplied: false` aunque el ahorro sea alto—. El caso negativo es el que impide que
alguien reintroduzca la derivación por porcentaje sin que nada falle.

### Un desglose obsoleto es peor que ninguno

El desglose se pide cuando cambian las líneas del carrito **o** el cupón aplicado, no solo al pulsar
"Aplicar". Si solo se recalculara al aplicar el cupón, agregar un producto dejaría en pantalla un
cálculo que ya no corresponde al carrito, y el usuario decidiría mirando un número falso.

Eso abre una carrera: pulsar `+` dos veces seguidas lanza dos peticiones, y si la primera responde
después de la segunda, la pantalla se queda con el desglose del carrito anterior. Se resuelve con un
contador de secuencia que descarta las respuestas que ya no son la más reciente. Son tres líneas.

Se descartaron deliberadamente el *debounce* y la cancelación de peticiones: resuelven un problema
de volumen que esta aplicación no tiene, y habrían añadido temporizadores y `AbortController` sin un
caso de uso que los justifique.

### Trade-offs asumidos en el cliente

- **Zustand en lugar de Redux o Context.** El estado es una pantalla con cuatro
  responsabilidades; Redux traería *actions*, *reducers* y *middleware* para un caso que se resuelve
  con un store y dos selectores. Context habría forzado a resolver la re-renderización a mano. El
  precio es que Zustand no impone una disciplina de mutaciones: se compensa con el estado declarado
  `readonly` y con actualizaciones inmutables.
- **Un solo store, partido en slices.** El cupón y el desglose dependen del carrito, así que dos
  stores separados obligarían a sincronizar dos fuentes para una sola pantalla. Se mantuvo un único
  store y, cuando el archivo superó las 250 líneas, se partió en *slices* (`cart.slice.ts`,
  `checkout.slice.ts`) que componen el mismo estado.
- **Sin router.** Es una pantalla. Añadir enrutado sería estructura sin destino.
- **Sin persistencia del carrito entre recargas.** Recargar vacía el carrito. Es aceptable en el
  alcance de la prueba y evita decidir una política de expiración que nadie pidió.
