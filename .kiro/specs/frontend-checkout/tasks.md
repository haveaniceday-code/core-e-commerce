# Implementation Plan: frontend-checkout

## Overview

Se amplía lo que `frontend-cart` dejó montado: el cliente de la API gana dos operaciones, el store
gana el cupón, el desglose y la confirmación, y `App` se parte en componentes porque pasa de dos
bloques a seis. De dentro hacia afuera —cliente, estado, pantalla— para que la lógica quede probada
sin renderizar antes de tocar ningún componente.

Lenguaje: TypeScript con `strict: true`. Cero `any`, cero assertions: los cuerpos de respuesta
entran como `unknown` y se estrechan con guardas, igual que hace `fetchCatalog`. Todas las pruebas
son **por ejemplo**.

## Tasks

- [x] 1. Cliente de la API
  - [x] 1.1 Extraer `src/api/http.ts` y ampliar el error tipado
    - Mover `ApiClientError` y las guardas de respuesta comunes desde `catalog.api.ts`: ahora tienen dos consumidores, así que se declaran una sola vez
    - `ApiClientError` transporta además el `code` de `ErrorCode` y los `details` cuando el cuerpo respeta `ApiError`, para que la UI distinga el `409` de stock sin interpretar el texto del mensaje
    - Ajustar `catalog.api.ts` para consumirlo, sin cambiar su comportamiento
    - _Requisitos: FK-R1.3, FK-R1.4_

  - [x] 1.2 Implementar `src/api/checkout.api.ts`
    - `requestPreview(request: CheckoutRequest): Promise<CheckoutTotals>` contra `POST /api/checkout/preview`
    - `confirmPurchase(request: CheckoutRequest): Promise<OrderConfirmation>` contra `POST /api/checkout`
    - Ambas con `Content-Type: application/json`, validando la respuesta con guardas de runtime y **sin assertions**
    - _Requisitos: FK-R1.1, FK-R1.2_

  - [x] 1.3 Escribir `src/api/checkout.api.spec.ts`
    - `200` devuelve el tipo validado; `409` con cuerpo `ApiError` produce un `ApiClientError` con `code` y `details`; cuerpo que no respeta la forma cae al mensaje genérico
    - _Requisitos: FK-R6.1_

- [x] 2. Estado del cupón, el desglose y la compra
  - [x] 2.1 Ampliar `src/store/cart.store.ts`
    - Campos nuevos: `couponDraft` y `appliedCoupon` **separados** —teclear no dispara peticiones, aplicar sí—, `totals`, `previewStatus`, `previewError`, `confirmation`, `purchaseStatus`, `purchaseError` y `shortages`
    - `refreshPreview()` se invoca al final de `add`, `decrement`, `remove` y `applyCoupon`: lo que se muestra corresponde siempre al estado actual
    - Carrito vacío: no se pide desglose y `totals` vuelve a `null`, en lugar de conservar el anterior
    - **Contador de secuencia**: una respuesta que ya no es la más reciente se descarta. Tres líneas contra el caso de pulsar `+` dos veces y quedarse con el desglose del carrito anterior. No hay *debounce* ni cancelación: no hay volumen que los justifique
    - Cupón desconocido o expirado **no es una rama de error**: llega `200` con la línea de cupón no aplicada y es la ruta satisfactoria
    - `confirmPurchase()`: en éxito guarda la confirmación, vacía `items` y recarga el catálogo para que el stock decrementado quede visible; en fallo guarda el mensaje y las `shortages` y **conserva el carrito**
    - `buildRequest` envía solo líneas y cupón, con spread condicional para que "sin cupón" sea la ausencia de la propiedad y no `undefined`
    - Sin recalcular descuentos ni re-redondear: se exponen los enteros de `CheckoutTotals` tal como llegan
    - Si el archivo supera ~250 líneas, partirlo en slices de Zustand dentro del mismo store
    - _Requisitos: FK-R2.1, FK-R2.2, FK-R2.3, FK-R2.4, FK-R2.5, FK-R2.6, FK-R2.7, FK-R5.3, FK-R5.6_

  - [x] 2.2 Ampliar `src/store/cart.store.spec.ts`
    - Disparo del desglose: `applyCoupon` lo pide; `add` lo pide; carrito vacío no lo pide y deja `totals` en `null`
    - Teclear en `couponDraft` no dispara ninguna petición
    - Respuesta obsoleta: dos peticiones, la primera resuelve última, gana la segunda
    - Cupón inválido: `applied: false` deja el desglose visible y `previewError` en `null`
    - Compra: éxito guarda la confirmación, vacía `items` y recarga el catálogo; `409` guarda las `shortages` y **conserva** `items`
    - _Requisitos: FK-R6.2, FK-R6.3, FK-R6.4, FK-R6.6_

- [x] 3. Componentes
  - [x] 3.1 Partir `App.tsx` en componentes
    - Extraer `CatalogTable` y `CartPanel` de lo que ya existe, sin cambiar comportamiento
    - `App.tsx` queda como composición: no decide nada
    - El criterio quedó escrito en `frontend-cart` —"si la entrega del cupón la hace crecer, se parte entonces"— y creció de dos bloques a seis
    - _Requisitos: FK-R3.5_

  - [x] 3.2 Implementar `CouponInput` y `DiscountBreakdown`
    - `CouponInput`: campo enlazado a `couponDraft` y botón "Aplicar" que despacha `applyCoupon`
    - `DiscountBreakdown`: **siempre las tres líneas** en orden de precedencia, aplicadas o no, con la `label` que viaja en cada una —el texto llega listo del backend, la UI no lo compone— y su monto con `formatCents`
    - Debajo: porcentaje efectivo, ahorro total y total a pagar, tomados de `CheckoutTotals`
    - El porcentaje es `effectiveDiscountBps / 100`: no es dinero y no está sujeto a la política de redondeo de importes, que sigue prohibiendo `toFixed`
    - Estados de recálculo y de fallo del desglose, sin tocar el carrito
    - _Requisitos: FK-R3.1, FK-R3.2, FK-R3.3, FK-R3.4, FK-R3.5_

  - [x] 3.3 Implementar `CapAlert`
    - Se renderiza **si y solo si** `totals.capApplied` es `true`. Nada de comparar `totalSavingsCents` con `capCents` ni `effectiveDiscountBps` con `3500`: un descuento de exactamente el 35% no dispara la alerta y esas derivaciones no saben distinguirlo
    - Texto en una constante, con la redacción exacta de `product-rules.md`: `¡Enhorabuena! Has alcanzado el límite máximo de ahorro permitido (35%)`
    - Persistente y distintiva: `role="alert"`, sin temporizador y sin botón de cerrar mientras la condición se cumpla
    - _Requisitos: FK-R4.1, FK-R4.2, FK-R4.3, FK-R4.4_

  - [x] 3.4 Implementar `OrderConfirmationPanel` y la acción de comprar
    - Botón de confirmar la compra, deshabilitado con el carrito vacío o con una petición en curso
    - Éxito: identificador de la orden, fecha, líneas compradas y totales de `OrderConfirmation`, **sin recalcular ningún monto**
    - Rechazo por stock: lista de `shortages` con producto, cantidad solicitada y disponible
    - Cualquier otro fallo: mensaje del error tipado
    - En los dos casos de fallo el carrito queda intacto
    - _Requisitos: FK-R5.1, FK-R5.2, FK-R5.4, FK-R5.5_

  - [x] 3.5 Ampliar `src/App.spec.tsx`
    - Las tres líneas del desglose se renderizan, incluida la de cupón no aplicada
    - **La alerta en sus dos direcciones**: presente con `capApplied: true`, ausente con `capApplied: false` aunque el ahorro sea alto. El caso negativo es el que protege contra reintroducir una derivación por porcentaje
    - El texto de la alerta se afirma **literal**, carácter por carácter
    - Confirmar muestra el comprobante y deja el carrito vacío; el `409` muestra las líneas deficitarias y el carrito sigue ahí
    - _Requisitos: FK-R6.5, FK-R6.6_

- [x] 4. Checkpoint final - Umbral de cobertura y demo de extremo a extremo
  - Ejecutar `npm run typecheck`, `npm run lint` y `npm run test:cov` en la raíz, verificando que los tres workspaces pasan y que el umbral del 80% se cumple en `apps/frontend` con los archivos nuevos dentro de la medición
  - Recorrido manual con el backend levantado: agregar productos, aplicar `WELCOME2026` y ver el desglose; aplicar `DEMOCAP50` y ver la alerta del tope; superar el stock de `PROD-005` y ver el `409` con las líneas deficitarias; comprar y comprobar que el catálogo recargado muestra el stock decrementado
  - Ensure all tests pass, ask the user if questions arise.
  - _Requisitos: FK-R6.7_

## Notes

- **Ninguna subtarea es opcional.** Lo que quedó en el plan o entrega una HU o sostiene el umbral.
- La tarea 1.1 mueve código existente sin cambiar comportamiento. `ApiClientError` y las guardas
  salen de `catalog.api.ts` porque ahora tienen dos consumidores; no es una capa nueva.
- La tarea 3.1 también es movimiento sin cambio de comportamiento. Conviene hacerla antes que 3.2
  para que el diff de los componentes nuevos no se mezcle con el de la extracción.
- Verificaciones que deliberadamente **no** son tests: que el frontend no calcule descuentos ni
  redondee importes (no existe la aritmética, y el lint prohíbe `toFixed`) y que la petición no
  lleve montos (`CheckoutRequest` no tiene dónde ponerlos, y eso lo garantiza `tsc`).
- Sin *debounce* y sin cancelación de peticiones: el contador de secuencia resuelve el problema real
  —una respuesta obsoleta pisando a la reciente— y lo demás sería infraestructura sin caso de uso.
- Fuera de alcance y sin tarea: autenticación, historial de órdenes y persistencia del carrito entre
  recargas.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4"] },
    { "id": 5, "tasks": ["3.5"] }
  ]
}
```
