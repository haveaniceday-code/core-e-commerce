# Requirements Document

## Introduction

Segunda entrega de `apps/backend`: los dos endpoints de checkout. `POST /api/checkout/preview`
calcula el desglose de descuentos sin efectos secundarios, y `POST /api/checkout` valida stock,
recalcula con el mismo motor, decrementa el stock de forma transaccional y persiste la orden.
Incluye el contrato nuevo `OrderConfirmation` en `packages/shared`, el adaptador Prisma del puerto
de confirmación de compra y la forma tipada del error de stock insuficiente.

Es la capa que cierra el backend como fuente de verdad del cálculo: el cliente envía qué quiere
comprar y con qué cupón, y el servidor decide los montos, el stock y la orden. Los montos que
llegan del cliente no se leen.

**Cadena de specs:** `monorepo-foundation` → `shared-contracts-seed` → `discount-engine` →
`backend-persistence` → `backend-checkout`. Referencias entre specs con prefijo (`MF-`, `SCS-`,
`DE-`, `BP-`, `BC-`); dentro del documento, `R2.4` es "Requerimiento 2, criterio 4". Criterios en
EARS.

**Hereda y no repite.** De `shared-contracts-seed`: `Product`, `CartItem`, `CheckoutTotals`,
`DiscountLine`, `ErrorCode`, `ApiError`, `CATALOG_PRODUCTS`, `COUPONS`, `findCouponByCode` y las
utilidades de dinero (`MICRO`, `roundHalfUp`, `formatCents`). De `discount-engine`:
`DiscountEngine.calculate(input)`, `DiscountStrategyFactory.create()`, `resolveCart` con su
validación de carrito y su tratamiento del cupón, y `DiscountDomainError`. De
`backend-persistence`: el bootstrap con prefijo `/api` y `ValidationPipe` global, `PrismaService`
como único instanciador de `PrismaClient`, `ApiExceptionFilter` con su `Record<ErrorCode, number>`
exhaustivo (409 / 404 / 400 / 500), la interfaz `ProductRepository`, los tipos de orden
`NewOrder`, `NewOrderLine` y `PersistedOrder`, los tokens de inyección, los modelos `Order` y
`OrderItem` del schema con su migración, y la configuración de Jest con umbral del 80% que rompe el
comando.

**Alcance acotado por decisión explícita:**

- La validación del carrito (producto inexistente, cantidad no entera o no positiva, precio
  inválido, cota de subtotal) **ya vive en `resolveCart`** y no se reimplementa ni se duplica en el
  backend. El backend añade lo que el motor no puede saber: el stock.
- La única regla de carrito que el backend sí añade es el **rechazo del carrito vacío en
  `checkout`**. No es una regla de validez del carrito —`preview` lo acepta y devuelve ceros— sino
  una regla del endpoint: una compra sin productos no es una orden.
- Un cupón desconocido o expirado **ya se resuelve a "sin cupón"** en el paquete compartido, sin
  excepción. El backend no lo trata como error.
- El decremento de stock usa **actualización condicional** (compare-and-swap) sobre la fila, dentro
  de una transacción, sin depender del nivel de aislamiento del motor de base de datos.
- El `409` de stock insuficiente reporta **todas** las líneas deficitarias, no solo la primera.
  Es una divergencia deliberada del comportamiento fail-fast de `resolveCart`.
- El decremento condicional y la creación de la orden se resuelven tras **un único puerto de
  dominio**, el Puerto_Confirmacion_Compra. `OrderRepository`, declarado sin implementación en
  `backend-persistence`, queda **subsumido por ese puerto y se elimina**: su `create` no puede
  ejecutarse fuera de la transacción del decremento, y conservar ambas superficies dejaría otra vez
  una interfaz sin consumidor. Sus tipos `NewOrder`, `NewOrderLine` y `PersistedOrder` se conservan.
- La comprobación de filas afectadas del compare-and-swap vive en una **función pura del dominio**,
  no dentro del adaptador Prisma, para que la guarda quede dentro de la medición de cobertura.

**Fuera de alcance:** `apps/frontend`, el modelo `Coupon` en Prisma, la consulta de órdenes
persistidas (`GET /api/orders`), la autenticación y la reserva temporal de stock.

## Glossary

- **Backend_API**: la aplicación NestJS de `apps/backend`, montada bajo el prefijo global `/api`.
- **Controlador_Checkout**: el controller HTTP que expone `POST /api/checkout/preview` y
  `POST /api/checkout`.
- **DTO_Checkout**: el objeto de entrada de ambos endpoints, validado en runtime con
  class-validator.
- **Servicio_Checkout**: el servicio de caso de uso que resuelve el catálogo, invoca el
  Motor_Descuentos, valida el stock, ordena el decremento y persiste la orden.
- **Motor_Descuentos**: el `DiscountEngine` de `@core/shared`, armado desde
  `DiscountStrategyFactory`.
- **Repositorio_Productos**: la interfaz de dominio `ProductRepository`, ya existente.
- **Verificador_Decremento**: la función pura de dominio que recibe el resultado de cada
  actualización condicional y decide si la unidad de compra continúa o aborta.
- **Puerto_Confirmacion_Compra**: el puerto de dominio que ejecuta, como una sola unidad, el
  decremento condicional de stock y la creación de la orden.
- **Adaptador_Prisma_Compra**: la implementación del Puerto_Confirmacion_Compra sobre Prisma, en la
  capa de infraestructura.
- **Contrato_Confirmacion**: el contrato de respuesta `OrderConfirmation` de `@core/shared`.
- **Paquete_Shared**: el paquete `@core/shared`, consumido únicamente por su entry público.
- **Suite_Backend**: la configuración y el conjunto de pruebas de Jest de `apps/backend`.

## Requirements

### Requerimiento 1: Contrato de confirmación de orden en el paquete compartido

**User Story:** Como desarrollador del frontend, quiero un contrato explícito de confirmación de
orden, para renderizar identificador, fecha, totales y líneas sin recalcular ni reformatear montos.

#### Acceptance Criteria

1. EL Paquete_Shared DEBERÁ declarar el Contrato_Confirmacion con el identificador de la orden, su
   marca temporal de creación, los totales del cálculo y las líneas de la orden.
2. EL Contrato_Confirmacion DEBERÁ expresar los totales reutilizando `CheckoutTotals`, de modo que
   exista una sola declaración de la forma del desglose para `preview` y para `checkout`.
3. EL Contrato_Confirmacion DEBERÁ expresar cada línea con el identificador del producto, su nombre,
   su categoría como literal sin tilde, la cantidad como entero positivo, el precio unitario en
   centavos enteros y el total de la línea en centavos enteros. EL nombre DEBERÁ tomarse del
   catálogo que el Servicio_Checkout ya leyó para el cálculo, porque la fila `OrderItem` no lo
   almacena; el precio unitario y el total de la línea DEBERÁN provenir de la orden persistida, por
   ser los montos efectivamente cobrados.
4. EL Contrato_Confirmacion DEBERÁ describir lo que realmente cruza el cable: la marca temporal como
   cadena en formato ISO 8601, y el código de cupón como propiedad opcional ausente cuando no se
   aplicó cupón, de modo que su ausencia signifique "sin cupón" bajo `exactOptionalPropertyTypes`.
5. EL Paquete_Shared DEBERÁ declarar como tipo exportado la forma de los detalles del error de stock
   insuficiente, con el identificador del producto, la cantidad solicitada y la cantidad disponible,
   de modo que backend y frontend lean la misma estructura.

### Requerimiento 2: Validación en runtime del cuerpo de la petición

**User Story:** Como desarrollador, quiero que el cuerpo se valide antes de llegar al caso de uso,
para que el servicio reciba una estructura conocida y el cliente obtenga un error claro.

#### Acceptance Criteria

1. EL DTO_Checkout DEBERÁ declarar exclusivamente la lista de líneas del carrito y el código de
   cupón opcional, sin aceptar montos, subtotales, descuentos ni totales enviados por el cliente.
2. EL DTO_Checkout DEBERÁ validar con class-validator que cada línea tenga un identificador de
   producto de tipo texto no vacío y una cantidad entera mayor a `0`, y que el código de cupón, si
   está presente, sea texto no vacío.
3. CUANDO el cuerpo no satisface el DTO_Checkout —propiedad ajena, lista de líneas ausente o que no
   es un arreglo—, EL Backend_API DEBERÁ responder `400` por efecto del `ValidationPipe` global, sin
   invocar al Servicio_Checkout.
4. EL DTO_Checkout DEBERÁ ser el mismo para `POST /api/checkout/preview` y para `POST /api/checkout`.

### Requerimiento 3: POST /api/checkout/preview sin efectos secundarios

**User Story:** Como cliente del carrito, quiero previsualizar el desglose en vivo, para ver el
ahorro antes de comprar sin que el sistema reserve ni modifique nada.

#### Acceptance Criteria

1. EL Controlador_Checkout DEBERÁ exponer `POST /api/checkout/preview` delegando en una única
   llamada al Servicio_Checkout, sin invocar al Motor_Descuentos y sin contener reglas de negocio.
2. EL Servicio_Checkout DEBERÁ obtener el catálogo a través del Repositorio_Productos y pasarlo al
   Motor_Descuentos junto con las líneas y el cupón de la petición, de modo que los precios usados
   sean los persistidos y no los del cliente.
3. CUANDO EL Backend_API atiende `POST /api/checkout/preview` con un carrito válido, DEBERÁ responder
   `200` con un cuerpo que respete la forma `CheckoutTotals`, con las tres líneas del desglose en
   orden de precedencia y los campos en micro-centavos junto a los de centavos. EL `200` DEBERÁ
   declararse de forma explícita, porque el valor por defecto de Nest para un `@Post()` es `201`.
4. EL Backend_API no DEBERÁ comprobar stock en `preview` ni modificar el stock o el conjunto de
   órdenes, ni siquiera cuando una línea solicita más unidades de las disponibles.
5. CUANDO la lista de líneas está vacía, EL Backend_API DEBERÁ responder `200` con subtotal original
   `0`, ahorro `0`, total final `0` y las tres líneas marcadas como no aplicadas, sin excepción.
6. CUANDO el código de cupón no está registrado o está expirado, EL Backend_API DEBERÁ responder
   `200` con el resto de la cascada calculado y la línea de cupón marcada como no aplicada.

### Requerimiento 4: Validación de stock y reporte del déficit

**User Story:** Como comprador, quiero saber exactamente qué productos no tienen stock suficiente y
cuánto hay disponible, para corregir el carrito en un solo intento.

#### Acceptance Criteria

1. EL Servicio_Checkout DEBERÁ comparar la cantidad solicitada contra el `stock` persistido antes de
   ordenar cualquier decremento, agregando la cantidad por producto, de modo que dos líneas del
   mismo producto se evalúen por su suma y no una por una.
2. EL Servicio_Checkout DEBERÁ rechazar únicamente cuando la cantidad supera **estrictamente** el
   stock disponible: una cantidad igual al stock se trata como satisfecha y el checkout continúa.
3. SI al menos una línea es deficitaria, ENTONCES EL Backend_API DEBERÁ responder `409` con un cuerpo
   que respete la forma `ApiError` y el código `INSUFFICIENT_STOCK`, incluyendo en los detalles
   **todas** las líneas deficitarias —identificador de producto, cantidad solicitada y cantidad
   disponible— en orden ascendente por identificador de producto, para que la respuesta sea
   determinista.
4. SI el checkout se rechaza por stock insuficiente, ENTONCES EL Backend_API DEBERÁ dejar el `stock`
   de todos los productos sin modificar y no DEBERÁ persistir ninguna orden ni línea de orden.
5. EL Servicio_Checkout DEBERÁ evaluar la validez del carrito antes que la disponibilidad de stock,
   de modo que un carrito con un producto inexistente responda `404` y no un `409`.
6. CUANDO `POST /api/checkout` recibe una lista de líneas vacía, EL Backend_API DEBERÁ responder
   `400` con el código `INVALID_CART` sin persistir orden alguna, porque una compra sin productos no
   es una orden válida.

### Requerimiento 5: POST /api/checkout con decremento transaccional y persistencia

**User Story:** Como comprador, quiero que al confirmar la compra el stock se descuente y la orden
quede guardada, para que el resultado sobreviva al reinicio y no se compre dos veces la misma unidad.

#### Acceptance Criteria

1. EL Controlador_Checkout DEBERÁ exponer `POST /api/checkout` delegando en una única llamada al
   Servicio_Checkout, sin orquestar transacciones ni tocar la persistencia directamente.
2. EL Servicio_Checkout DEBERÁ recalcular los totales con el mismo Motor_Descuentos que atiende
   `preview`, sobre el catálogo persistido y sin leer ningún monto enviado por el cliente, de modo
   que un mismo carrito y un mismo cupón produzcan montos idénticos en centavos en ambos endpoints.
3. EL Puerto_Confirmacion_Compra DEBERÁ decrementar el stock de todas las líneas y crear la orden con
   sus líneas como una sola unidad atómica, de modo que ningún estado intermedio quede persistido si
   cualquier paso falla.
4. EL Adaptador_Prisma_Compra DEBERÁ decrementar cada producto con una actualización condicionada a
   que el stock de la fila siga siendo suficiente y comprobar las filas afectadas; SI alguna no
   afecta ninguna fila, DEBERÁ delegar en el Verificador_Decremento, abortar la transacción completa
   y fallar con `INSUFFICIENT_STOCK`, de modo que la corrección no dependa del nivel de aislamiento
   del motor de base de datos.
5. CUANDO el checkout se completa correctamente, EL Backend_API DEBERÁ responder `201` con un cuerpo
   que respete el Contrato_Confirmacion, con el identificador de la orden persistida, su marca
   temporal, los totales recalculados y una línea por cada producto comprado.
6. EL Servicio_Checkout DEBERÁ persistir en la orden el subtotal original, el ahorro total, el total
   final, el indicador de tope aplicado y el código de cupón cuando el cupón se aplicó; y en cada
   línea, el precio unitario vigente al momento de la compra y el total de la línea, de modo que la
   orden siga siendo auditable si el precio del catálogo cambia después. Todos los montos como
   enteros en centavos.
7. CUANDO se consulta `GET /api/products` después de un checkout exitoso, EL Backend_API DEBERÁ
   devolver el `stock` ya decrementado. Su conservación tras reiniciar el proceso es una **garantía
   estructural** —el arranque no siembra, no restaura y no escribe— y se verifica en la demostración
   en vivo, no con una prueba automatizada.

### Requerimiento 6: Separación de capas y puertos de dominio

**User Story:** Como desarrollador, quiero la transacción y el acceso a datos detrás de puertos de
dominio, para que el caso de uso se pruebe sin base de datos y cambiar de motor no toque la lógica.

#### Acceptance Criteria

1. EL Puerto_Confirmacion_Compra DEBERÁ declararse en la capa de dominio en términos de contratos del
   Paquete_Shared y de los tipos de orden ya declarados, sin mencionar Prisma, transacciones
   concretas ni tipos generados por el ORM.
2. EL Backend_API DEBERÁ resolver el Puerto_Confirmacion_Compra por un token de inyección estable
   declarado en el dominio, con el binding a su adaptador concreto en un único módulo, de modo que
   una prueba lo sustituya sin modificar al Servicio_Checkout.
3. EL Servicio_Checkout DEBERÁ construir el Motor_Descuentos desde `DiscountStrategyFactory` y no
   DEBERÁ redeclarar tasas, umbrales, orden de precedencia, política de redondeo ni el tope del 35%,
   ni ejecutar operación aritmética de redondeo alguna sobre montos calculados.
4. EL Adaptador_Prisma_Compra DEBERÁ obtener el acceso a la base de datos exclusivamente desde el
   provider `PrismaService` existente, sin instanciar un cliente propio.
5. EL Backend_API DEBERÁ eliminar la interfaz `OrderRepository` y su token `ORDER_REPOSITORY`,
   subsumidos por el Puerto_Confirmacion_Compra, conservando los tipos `NewOrder`, `NewOrderLine` y
   `PersistedOrder`. EL schema y las migraciones existentes DEBERÁN quedar sin cambios: esta entrega
   no añade ninguna migración.
6. EL Verificador_Decremento DEBERÁ declararse en el dominio como función pura que recibe el
   resultado de las actualizaciones condicionales y lanza el error tipado de stock insuficiente
   cuando alguna no afectó fila. Es una función corta y existe por una razón concreta: deja la
   guarda del compare-and-swap fuera del adaptador Prisma y dentro de la medición de cobertura.

### Requerimiento 7: Forma tipada del error

**User Story:** Como cliente del carrito, quiero errores con un código estable y un cuerpo
predecible, para reaccionar en la UI sin interpretar mensajes de texto.

#### Acceptance Criteria

1. EL Backend_API DEBERÁ responder todos los fallos de ambos endpoints con un cuerpo que respete la
   forma `ApiError` y un código de la unión `ErrorCode`: `404` para `PRODUCT_NOT_FOUND`, `400` para
   `INVALID_CART`, `409` para `INSUFFICIENT_STOCK` y `500` para `INTERNAL_ERROR`.
2. EL Backend_API DEBERÁ producir esos estados mediante el `ApiExceptionFilter` existente y su tabla
   exhaustiva de códigos, sin añadir bloques de captura de excepciones en el Controlador_Checkout.
3. EL Backend_API no DEBERÁ tratar un código de cupón desconocido o expirado como error en ninguno
   de los dos endpoints.

### Requerimiento 8: Pruebas y umbral de cobertura

**User Story:** Como desarrollador, quiero los casos borde del checkout cubiertos con dobles
tipados, para que el rechazo por stock y la atomicidad sean condiciones verificadas.

#### Acceptance Criteria

1. LA Suite_Backend DEBERÁ ejecutar las pruebas unitarias con Jest sin requerir base de datos,
   servidor externo ni variables de entorno adicionales, con dobles en memoria del
   Repositorio_Productos y del Puerto_Confirmacion_Compra, tipados por completo, sin `any`, sin
   assertions de tipo y sin `@ts-ignore`.
2. LA Suite_Backend DEBERÁ probar el rechazo por stock insuficiente afirmando el `409`, el código,
   la presencia de todas las líneas deficitarias en los detalles, que el stock del doble no se
   modificó y que no se creó ninguna orden.
3. LA Suite_Backend DEBERÁ probar la frontera del stock con `PROD-005` y su stock `3`: una cantidad
   igual al disponible continúa, una unidad más rechaza.
4. LA Suite_Backend DEBERÁ probar que `preview` no modifica stock ni crea órdenes, incluso cuando el
   carrito solicita más unidades de las disponibles.
5. LA Suite_Backend DEBERÁ probar que un mismo carrito produce montos idénticos en centavos enteros
   a través de `preview` y de `checkout`, afirmando la igualdad campo por campo de los totales.
6. LA Suite_Backend DEBERÁ probar el carrito vacío en ambos endpoints: ahorro cero sin excepción en
   `preview`, y `400` con `INVALID_CART` sin persistencia en `checkout`.
7. LA Suite_Backend DEBERÁ probar el carrito con datos corruptos —producto inexistente y cantidad no
   positiva— afirmando el código tipado y el estado HTTP correspondiente.
8. LA Suite_Backend DEBERÁ probar los cupones: `WELCOME2026` aplicado en su orden de precedencia,
   `SUMMER2024` expirado ignorado sin interrumpir la cascada, un código no registrado ignorado del
   mismo modo, y `DEMOCAP50` afirmando que el indicador de tope aplicado llega en los totales y queda
   persistido en la orden.
9. LA Suite_Backend DEBERÁ probar que una actualización condicional sin filas afectadas aborta la
   unidad completa, dejando el almacén doble sin decrementos y sin orden persistida. Basta un
   escenario: es una guarda de carrera, no una regla de negocio con casos.
10. LA Suite_Backend DEBERÁ incluir pruebas end-to-end de ambos endpoints con supertest, arrancando
    el módulo de Nest con los adaptadores de persistencia sustituidos por dobles en memoria, y
    afirmando los estados `200` y `201`, la forma del cuerpo y el `400` de un cuerpo inválido.
11. LA Suite_Backend DEBERÁ mantener `coverageThreshold` en `80` por ciento de líneas y de ramas
    incluyendo los archivos de esta entrega, rompiendo el comando cuando no se cumple. DENTRO de la
    medición quedan el Servicio_Checkout, el Controlador_Checkout, el DTO_Checkout y el
    Verificador_Decremento; EL Adaptador_Prisma_Compra solo DEBERÁ excluirse si, extraída la
    verificación, queda sin ramas propias.
