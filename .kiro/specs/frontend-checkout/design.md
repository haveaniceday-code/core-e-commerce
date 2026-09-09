# Design Document

## Overview

Esta entrega no añade capas: añade estado y pantalla sobre lo que `frontend-cart` ya montó. El
`Cliente_Api` gana dos operaciones, el store gana el cupón, el desglose y la confirmación, y `App`
se parte en componentes porque ahora compone seis bloques en lugar de dos.

La idea que gobierna el diseño es una sola: **el frontend muestra, no decide**. No calcula
descuentos, no redondea, no compara porcentajes y no deduce si el tope se activó. Pide
`POST /api/checkout/preview` y pinta los enteros que llegan. La única aritmética de dinero que
sobrevive es el subtotal optimista de la entrega anterior, que es un producto de enteros.

Lenguaje: TypeScript con `strict: true`. Cero `any`, cero assertions. Pruebas por ejemplo con
Vitest y React Testing Library.

### Decisiones de alcance ya cerradas

| # | Decisión |
|---|----------|
| D1 | Cupón, desglose y confirmación viven en el **mismo store** que el carrito. Dos stores para una pantalla obligarían a sincronizar dos fuentes. |
| D2 | El desglose se pide cuando cambian las líneas **o** el cupón aplicado, no solo al pulsar "Aplicar": un desglose obsoleto es peor que ninguno. |
| D3 | La alerta se decide **solo** por `capApplied`. El frontend no re-deriva la condición. |
| D4 | Un cupón desconocido o expirado **no es un error**: `200` con la línea de cupón no aplicada. |

## Architecture

```
App.tsx                     compone y no decide nada
 ├── CatalogTable           catálogo + agregar                        [de frontend-cart]
 ├── CartPanel              líneas, controles, subtotal optimista     [de frontend-cart]
 ├── CouponInput            campo + "Aplicar"                         [nuevo]
 ├── DiscountBreakdown      3 líneas + efectivo + ahorro + total      [nuevo]
 ├── CapAlert               alerta persistente del 35%                [nuevo]
 └── OrderConfirmationPanel comprobante de la orden                   [nuevo]
        │
        ▼  todos leen del store; ninguno invoca fetch
   store/cart.store.ts      catálogo, items, cupón, totals, confirmación
        │
        ▼
   api/                     http.ts (error + guardas) · catalog.api.ts · checkout.api.ts
```

`App.tsx` se parte ahora y no antes porque el criterio quedó escrito en `frontend-cart`: *"si la
entrega del cupón la hace crecer, se parte entonces"*. Creció de dos bloques a seis, así que se
parte. Los componentes son tontos: reciben del store y despachan acciones.

### Archivos

```
apps/frontend/src/
├── api/
│   ├── http.ts                     # ApiClientError + guardas comunes      [extraído]
│   ├── catalog.api.ts              # usa http.ts                           [editado]
│   ├── checkout.api.ts             # requestPreview + confirmPurchase      [nuevo]
│   └── checkout.api.spec.ts        #                                       [nuevo]
├── store/
│   ├── cart.store.ts               # + cupón, desglose, confirmación       [editado]
│   └── cart.store.spec.ts          # + casos nuevos                        [editado]
├── components/
│   ├── CatalogTable.tsx            # extraído de App                       [nuevo]
│   ├── CartPanel.tsx               # extraído de App                       [nuevo]
│   ├── CouponInput.tsx             #                                       [nuevo]
│   ├── DiscountBreakdown.tsx       #                                       [nuevo]
│   ├── CapAlert.tsx                #                                       [nuevo]
│   └── OrderConfirmationPanel.tsx  #                                       [nuevo]
├── App.tsx                         # solo composición                      [editado]
└── App.spec.tsx                    # + casos nuevos                        [editado]
```

`ApiClientError` y las guardas de respuesta salen de `catalog.api.ts` a `http.ts` porque ahora
tienen dos consumidores. No es una capa nueva: es el mismo código en el sitio donde ambos lo ven.

**Umbral de partición del store.** `cart.store.ts` crece a un solo archivo con cuatro
responsabilidades. Se mantiene así mientras no pase de ~250 líneas; si las pasa, se parte en slices
de Zustand dentro del mismo store. Queda escrito para que sea una decisión y no un descuido.

## Cliente de la API

```ts
// src/api/http.ts
export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly code?: ErrorCode,
    readonly details?: Record<string, unknown>,
  ) { super(message); }
}
```

`code` y `details` son la novedad. Sin ellos, distinguir un `409` de stock de un `400` obligaría a
leer el texto del mensaje, que es exactamente lo que un código de error existe para evitar. Con
ellos, `OrderConfirmationPanel` puede pedir las `shortages` sin interpretar prosa:

```ts
// src/api/checkout.api.ts
export const requestPreview = (request: CheckoutRequest): Promise<CheckoutTotals> => ...
export const confirmPurchase = (request: CheckoutRequest): Promise<OrderConfirmation> => ...
```

Ambas hacen `POST` con `Content-Type: application/json`, validan la respuesta con guardas de runtime
—igual que `fetchCatalog` valida el catálogo— y lanzan `ApiClientError` en cualquier otro caso. Cero
assertions: el cuerpo entra como `unknown` y se estrecha con predicados.

## Estado

```ts
interface CheckoutSlice {
  /** Lo que el usuario teclea. Cambiarlo NO dispara peticiones. */
  readonly couponDraft: string;
  /** Lo que quedó aplicado. Cambiarlo SÍ dispara el desglose. */
  readonly appliedCoupon: string | null;

  readonly totals: CheckoutTotals | null;
  readonly previewStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly previewError: string | null;

  readonly confirmation: OrderConfirmation | null;
  readonly purchaseStatus: 'idle' | 'sending' | 'done' | 'error';
  readonly purchaseError: string | null;
  readonly shortages: readonly StockShortage[];

  setCouponDraft(value: string): void;
  applyCoupon(): void;
  refreshPreview(): Promise<void>;
  confirmPurchase(): Promise<void>;
}
```

**Borrador y aplicado son dos campos distintos** (R2.2). Si fueran uno, cada tecla dispararía una
petición al backend. HU 2 dice "ingresar el código y presionar Aplicar", y esta separación es
literalmente eso.

### Cuándo se pide el desglose

Cambian las líneas **o** cambia el cupón aplicado ⇒ `refreshPreview()`. Las acciones `add`,
`decrement` y `remove` de `frontend-cart` lo invocan al final, y `applyCoupon` también. Con el
carrito vacío no se pide nada y `totals` vuelve a `null`: llamar a `preview` para un carrito sin
líneas es un viaje de ida y vuelta para que el backend devuelva ceros que la UI ya sabe pintar.

### Descarte de respuestas obsoletas

```ts
let previewSequence = 0;

refreshPreview: async () => {
  const sequence = ++previewSequence;
  const totals = await requestPreview(buildRequest(get()));
  if (sequence !== previewSequence) return;   // llegó tarde: otra petición la adelantó
  set({ totals, previewStatus: 'ready' });
}
```

Tres líneas contra un bug real: pulsar `+` dos veces seguidas lanza dos peticiones, y si la primera
responde después de la segunda, la pantalla se queda con el desglose del carrito anterior. Es un
contador, no una cancelación ni un *debounce*: no hay volumen que justifique ninguno de los dos.

### El cupón inválido no es un error

`resolveCart` en el backend ya resuelve un código desconocido o expirado a "sin cupón", así que
`preview` responde `200` con la línea `COUPON` en `applied: false`. El store no tiene rama para
ello: es la ruta satisfactoria. La UI muestra la línea no aplicada, que es la señal de que el cupón
no valía.

### Petición

```ts
const buildRequest = (state: CartState): CheckoutRequest => ({
  items: Object.entries(state.items).map(([productId, quantity]) => ({ productId, quantity })),
  ...(state.appliedCoupon === null ? {} : { couponCode: state.appliedCoupon }),
});
```

Solo líneas y cupón. No hay campo donde meter un monto, y el spread condicional respeta
`exactOptionalPropertyTypes`: "sin cupón" es la **ausencia** de la propiedad, no `undefined`.

## Pantalla

**`DiscountBreakdown`** pinta las tres líneas siempre, aplicadas o no, con la `label` que viaja en
cada una —el texto ya viene listo del backend, la UI no lo compone— y su `discountCents` formateado
con `formatCents`. Debajo: porcentaje efectivo, ahorro total y total a pagar.

El porcentaje sale de `effectiveDiscountBps / 100`. Es la única división de la app, y es legítima:
no es dinero, sino una presentación de un entero en puntos básicos. La prohibición de `toFixed`
sigue vigente **sobre importes**.

**`CapAlert`** es el componente más simple y el más fácil de equivocar:

```tsx
if (!totals?.capApplied) return null;
return <div role="alert" className="cap-alert">{CAP_ALERT_TEXT}</div>;
```

Tres cosas deliberadas. El texto es una constante con la redacción exacta de
`product-rules.md`. La condición es `capApplied` y **nada más**: ni `totalSavingsCents === capCents`,
ni comparar `effectiveDiscountBps` con `3500`, porque un descuento de exactamente el 35% no dispara
la alerta y esas dos derivaciones no saben distinguirlo. Y no hay temporizador ni botón de cerrar:
la alerta vive mientras la condición se cumpla, que es lo que "persistente" significa en HU 4.

**`OrderConfirmationPanel`** tiene tres estados: la orden confirmada, el rechazo por stock con su
lista de `shortages`, y cualquier otro fallo con su mensaje. En los dos casos de fallo **el carrito
queda intacto**, para que el usuario corrija y reintente.

Tras un éxito el carrito se vacía y se recarga el catálogo. Esa recarga es lo que hace visible el
stock decrementado, y es el momento de la demostración en vivo.

## Error Handling

| situación | de dónde viene | qué muestra la UI |
|---|---|---|
| Cupón desconocido o expirado | `200` con `applied: false` | la línea de cupón no aplicada. **No es error** |
| Fallo del desglose | `ApiClientError` | aviso junto al desglose; el carrito no se toca |
| Stock insuficiente | `409` con `details.shortages` | producto, solicitado y disponible por línea; carrito intacto |
| Producto inexistente o carrito inválido | `404` / `400` | mensaje del error tipado; carrito intacto |
| Fallo interno o de red | `500` / excepción | mensaje genérico; carrito intacto |

## Testing Strategy

Todo por ejemplo, con el `Cliente_Api` doblado. Sin servidor, sin base de datos.

**`cart.store.spec.ts`** (ampliado):

| bloque | casos |
|---|---|
| Disparo del desglose | `applyCoupon` lo pide; `add` lo pide; carrito vacío no lo pide y deja `totals` en `null` |
| Borrador vs aplicado | teclear en el borrador no dispara ninguna petición |
| Respuesta obsoleta | dos peticiones, la primera resuelve última ⇒ gana la segunda |
| Cupón inválido | `applied: false` deja el desglose visible y `previewError` en `null` |
| Compra | éxito guarda la confirmación, vacía `items` y recarga el catálogo; `409` guarda las `shortages` y **conserva** `items` |

**`checkout.api.spec.ts`**: `200` devuelve el tipo validado; `409` con `ApiError` produce un
`ApiClientError` con `code` y `details`; cuerpo que no respeta la forma cae al mensaje genérico.

**`App.spec.tsx`** (ampliado), con React Testing Library:

- Las tres líneas del desglose se renderizan, incluida la de cupón no aplicada.
- **La alerta en sus dos direcciones**: presente con `capApplied: true`; ausente con
  `capApplied: false` aunque el ahorro sea alto. El caso negativo es el que protege contra
  reintroducir una derivación por porcentaje.
- El texto de la alerta se afirma **literal**, carácter por carácter.
- Confirmar muestra el comprobante y deja el carrito vacío; el `409` muestra las líneas deficitarias
  y el carrito sigue ahí.

**Cobertura.** Umbral del 80% en líneas y ramas, rompiendo el comando. Los componentes nuevos entran
en la medición; `main.tsx` sigue excluido.

## Invariantes verificados

| # | invariante | verificado por |
|---|---|---|
| I1 | La alerta aparece si y solo si `capApplied` es `true` | `App.spec.tsx`, en ambas direcciones |
| I2 | El texto de la alerta es exactamente el de `product-rules.md` | `App.spec.tsx`, literal |
| I3 | Un desglose obsoleto nunca reemplaza al más reciente | `cart.store.spec.ts` |
| I4 | Un cupón inválido no produce error ni oculta el desglose | store y pantalla |
| I5 | Un checkout rechazado conserva el carrito | `cart.store.spec.ts`, `App.spec.tsx` |
| I6 | El frontend no calcula descuentos ni redondea importes | **estructural** — no hay aritmética de dinero fuera del subtotal optimista, y el lint prohíbe `toFixed` |
| I7 | La petición no lleva montos | **estructural** — `CheckoutRequest` no tiene campos de importe |

I6 e I7 no llevan prueba porque son ausencias: no existe el código que habría que verificar. El
contrato compartido no tiene dónde poner un monto, y eso lo garantiza `tsc`, no un test.
