# Requirements Document

## Introduction

Segunda y última entrega de `apps/frontend`: el cupón, el desglose de descuentos, la alerta del tope
y la confirmación de la orden. Cubre **HU 2 — Aplicación Dinámica de Cupón y Visualización de
Desglose**, **HU 4 — Alerta de Descuento Límite Alcanzado** y la cara de cliente de **HU 3**.

Cierra el circuito: el carrito de `frontend-cart` ya existe y suma su subtotal optimista; esta
entrega le añade lo que solo el backend puede decidir —cuánto se descuenta, si el tope se activó y
qué orden quedó persistida— y lo muestra sin recalcular nada.

**Cadena de specs:** `monorepo-foundation` → `shared-contracts-seed` → `discount-engine` →
`backend-persistence` → `backend-checkout` → `frontend-cart` → `frontend-checkout`. Referencias
entre specs con prefijo (`MF-`, `SCS-`, `DE-`, `BP-`, `BC-`, `FC-`, `FK-`); dentro del documento,
`R2.3` es "Requerimiento 2, criterio 3". Criterios en EARS.

**Hereda y no repite.** De `frontend-cart`: el workspace de Vite, el `Store_Carrito` con `catalog`,
`items` y sus acciones, `selectCartLines`, `selectSubtotalCents`, el `Cliente_Api` con
`ApiClientError` y sus guardas de runtime, y el umbral del 80%. De `shared-contracts-seed` y
`backend-checkout`: `CheckoutTotals`, `DiscountLine`, `CheckoutRequest`, `OrderConfirmation`,
`StockShortage`, `ApiError`, `DISCOUNT_LABEL` y `formatCents`.

**Alcance acotado por decisión explícita:**

- El frontend **no calcula descuentos ni redondea**. Pide `POST /api/checkout/preview` y muestra los
  enteros que llegan. La única aritmética que conserva es el subtotal optimista de `frontend-cart`.
- El cupón, el desglose y la confirmación viven en el **mismo store** que el carrito. Un segundo
  store obligaría a sincronizar dos fuentes para una sola pantalla.
- La alerta del tope se decide **solo** por `capApplied` del backend. El frontend no compara
  porcentajes ni re-deriva la condición.
- Un cupón no registrado o expirado **no es un error**: llega `200` con la línea de cupón no
  aplicada, y así se muestra.

**Fuera de alcance:** autenticación, historial de órdenes, persistencia del carrito entre recargas y
cualquier endpoint que no sea `preview` y `checkout`.

## Glossary

- **Store_Compra**: el store de Zustand de `frontend-cart`, ampliado con el cupón, el desglose y la
  confirmación.
- **Cliente_Api**: el módulo que habla HTTP; único punto de la app que invoca `fetch`.
- **Panel_Desglose**: el bloque que muestra las tres líneas de descuento y los totales.
- **Alerta_Tope**: la notificación persistente del límite máximo de ahorro.
- **Panel_Confirmacion**: el bloque que muestra la orden persistida tras un checkout exitoso.
- **Paquete_Shared**: el paquete `@core/shared`, consumido únicamente por su entry público.
- **Suite_Frontend**: la configuración y el conjunto de pruebas de Vitest de `apps/frontend`.

## Requirements

### Requerimiento 1: Cliente de la API para checkout

**User Story:** Como desarrollador, quiero las dos llamadas de checkout en el mismo módulo que el
catálogo, para que la app siga teniendo un único punto que conoce HTTP.

#### Acceptance Criteria

1. EL Cliente_Api DEBERÁ exponer una operación de previsualización contra
   `POST /api/checkout/preview` que reciba un `CheckoutRequest` y devuelva `CheckoutTotals`,
   validando la respuesta en el borde con guardas de runtime, sin assertions de tipo.
2. EL Cliente_Api DEBERÁ exponer una operación de compra contra `POST /api/checkout` que reciba un
   `CheckoutRequest` y devuelva `OrderConfirmation`, validada del mismo modo.
3. EL `ApiClientError` DEBERÁ transportar, además del mensaje, el código de la unión `ErrorCode` y
   los detalles del error cuando el cuerpo respeta la forma `ApiError`, de modo que la interfaz
   distinga el stock insuficiente de cualquier otro fallo sin interpretar el texto del mensaje.
4. EL Cliente_Api DEBERÁ seguir siendo el **único** módulo de la App que invoca `fetch`, y las
   piezas comunes —el error tipado y las guardas de respuesta— DEBERÁN declararse una sola vez y
   reutilizarse entre catálogo y checkout.

### Requerimiento 2: Estado del cupón y del desglose

**User Story:** Como cliente, quiero que el desglose refleje siempre mi carrito y mi cupón actuales,
para no tomar una decisión mirando un cálculo viejo.

#### Acceptance Criteria

1. EL Store_Compra DEBERÁ alojar el cupón, el desglose y la confirmación junto al carrito ya
   existente, sin introducir un segundo store que haya que mantener sincronizado.
2. EL Store_Compra DEBERÁ conservar el código de cupón que el usuario escribe y el que quedó
   aplicado como valores distintos, de modo que teclear no dispare peticiones y sí lo haga la acción
   de aplicar.
3. CUANDO cambian las líneas del carrito o el cupón aplicado, EL Store_Compra DEBERÁ solicitar el
   desglose al backend, de modo que lo que se muestra corresponda siempre al estado actual.
4. CUANDO el carrito está vacío, EL Store_Compra no DEBERÁ solicitar desglose alguno ni conservar
   uno anterior.
5. CUANDO llega la respuesta de una petición de desglose que ya no es la más reciente, EL
   Store_Compra DEBERÁ descartarla, de modo que una sucesión rápida de cambios no deje en pantalla
   el resultado de una petición anterior.
6. CUANDO el cupón no está registrado o está expirado, EL Store_Compra DEBERÁ tratar la respuesta
   como satisfactoria y conservar el desglose con la línea de cupón no aplicada, sin mostrar error.
7. EL Store_Compra no DEBERÁ recalcular descuentos, re-redondear montos ni derivar totales: expone
   los enteros de `CheckoutTotals` tal como llegan.

### Requerimiento 3: Desglose en pantalla

**User Story:** Como cliente, quiero ver el detalle de cada descuento, el porcentaje efectivo, el
ahorro y el total a pagar, para entender de dónde sale el precio final.

#### Acceptance Criteria

1. EL Panel_Desglose DEBERÁ mostrar **siempre las tres líneas** —categoría, volumen y cupón— en su
   orden de precedencia, aplicadas o no, usando la etiqueta que viaja en cada línea.
2. CADA línea DEBERÁ mostrar si aplicó, su tasa y su monto de descuento formateado con `formatCents`
   del Paquete_Shared.
3. EL Panel_Desglose DEBERÁ mostrar el porcentaje de descuento efectivo, el ahorro total y el valor
   final a pagar, tomados de `CheckoutTotals`.
4. EL porcentaje efectivo DEBERÁ presentarse dividiendo entre `100` los puntos básicos enteros que
   llegan del backend. No es dinero y no está sujeto a la política de redondeo de montos, que sigue
   prohibiendo `toFixed` sobre cualquier importe.
5. LA App DEBERÁ distinguir en pantalla que el desglose se está recalculando y que su petición
   falló, sin borrar el carrito en ninguno de los dos casos.

### Requerimiento 4: Alerta de descuento límite alcanzado

**User Story:** Como cliente, quiero saber cuándo alcancé el ahorro máximo permitido, para entender
por qué el descuento dejó de crecer.

#### Acceptance Criteria

1. LA Alerta_Tope DEBERÁ mostrarse **si y solo si** `capApplied` de la respuesta es `true`.
2. LA Alerta_Tope DEBERÁ decir exactamente `¡Enhorabuena! Has alcanzado el límite máximo de ahorro
   permitido (35%)`, sin variaciones.
3. LA Alerta_Tope DEBERÁ ser persistente y visualmente distintiva: permanece mientras la condición
   se cumpla y no se desvanece sola ni se puede cerrar dejando la condición activa.
4. LA App no DEBERÁ re-derivar la condición del tope comparando porcentajes, montos ni tasas: la
   decisión es del backend y viaja en la respuesta.

### Requerimiento 5: Confirmación de la orden

**User Story:** Como cliente, quiero confirmar la compra y ver el comprobante, para saber que la
orden quedó registrada y con qué montos.

#### Acceptance Criteria

1. LA App DEBERÁ ofrecer una acción de confirmar la compra, deshabilitada cuando el carrito está
   vacío o cuando ya hay una petición de compra en curso.
2. CUANDO la compra se completa, LA App DEBERÁ mostrar el Panel_Confirmacion con el identificador de
   la orden, su fecha, las líneas compradas y los totales que devuelve `OrderConfirmation`, sin
   recalcular ningún monto.
3. CUANDO la compra se completa, LA App DEBERÁ vaciar el carrito y recargar el catálogo, de modo que
   el `stock` ya decrementado quede visible en pantalla.
4. SI la compra se rechaza por stock insuficiente, ENTONCES LA App DEBERÁ mostrar las líneas
   deficitarias que viajan en los detalles del error —producto, cantidad solicitada y cantidad
   disponible— y DEBERÁ conservar el carrito intacto para que el usuario lo corrija.
5. SI la compra falla por cualquier otra causa, ENTONCES LA App DEBERÁ mostrar el mensaje del error
   tipado y conservar el carrito intacto.
6. LA App DEBERÁ enviar en la petición únicamente las líneas del carrito y el cupón aplicado, sin
   incluir montos, subtotales ni totales.

### Requerimiento 6: Pruebas y umbral de cobertura

**User Story:** Como desarrollador, quiero el cupón, la alerta y la confirmación cubiertos, para que
el comportamiento reactivo sea una condición verificada.

#### Acceptance Criteria

1. LA Suite_Frontend DEBERÁ ejecutarse con Vitest y React Testing Library sobre `jsdom`, con el
   Cliente_Api sustituido por dobles tipados, sin `any` y sin servidor real.
2. LA Suite_Frontend DEBERÁ probar que aplicar un cupón y que modificar el carrito solicitan el
   desglose, y que un carrito vacío no lo solicita ni conserva el anterior.
3. LA Suite_Frontend DEBERÁ probar que la respuesta de una petición de desglose obsoleta se descarta
   y no reemplaza a la más reciente.
4. LA Suite_Frontend DEBERÁ probar que un cupón no registrado o expirado deja el desglose visible
   con la línea de cupón no aplicada y sin mensaje de error.
5. LA Suite_Frontend DEBERÁ probar la Alerta_Tope en sus dos direcciones: presente con
   `capApplied: true` y ausente con `capApplied: false`, incluso cuando el ahorro es alto.
6. LA Suite_Frontend DEBERÁ probar la confirmación: el éxito muestra la orden, vacía el carrito y
   recarga el catálogo; el rechazo por stock muestra las líneas deficitarias y conserva el carrito.
7. LA Suite_Frontend DEBERÁ mantener `coverageThreshold` en `80` por ciento de líneas y de ramas
   incluyendo los archivos de esta entrega, y `npm run test:cov --workspace apps/frontend` DEBERÁ
   salir con código distinto de `0` cuando cualquiera de los dos porcentajes queda por debajo.
