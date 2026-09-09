---
inclusion: always
---

# Reglas de Producto, Catálogo y Contratos

Este archivo fija los valores concretos del dominio. Todo lo que aquí se define es
canónico: el catálogo, los cupones, los umbrales, el redondeo, el contrato de la API y el
texto de la alerta. No inventes datos de producto ni textos de UI que no estén aquí.

## Categorías

El literal interno va **sin tilde**; la tilde existe solo en la etiqueta que se muestra.

```ts
type ProductCategory = 'Tecnologia' | 'Hogar' | 'Ropa';

const CATEGORY_LABEL: Record<ProductCategory, string> = {
  Tecnologia: 'Tecnología',
  Hogar: 'Hogar',
  Ropa: 'Ropa',
};
```

Motivo: la comparación del `CategoryDiscount` es contra el literal, y una divergencia de
tilde produce un fallo silencioso (el descuento simplemente no se aplica y ningún test
obvio lo detecta). Nunca compares contra la etiqueta.

## Catálogo pre-configurado

Los precios están en **centavos enteros**. Este es el seed único, compartido por el backend
y por los tests.

| id | nombre | categoría | precio (centavos) | precio (USD) | stock |
|----|--------|-----------|-------------------|--------------|-------|
| `PROD-001` | Laptop Pro 14" | `Tecnologia` | 129900 | $1299.00 | 5 |
| `PROD-002` | Auriculares Bluetooth | `Tecnologia` | 7990 | $79.90 | 12 |
| `PROD-003` | Teclado Mecánico | `Tecnologia` | 4550 | $45.50 | 8 |
| `PROD-004` | Lámpara de Escritorio | `Hogar` | 3200 | $32.00 | 15 |
| `PROD-005` | Juego de Sábanas | `Hogar` | 5900 | $59.00 | 3 |
| `PROD-006` | Camiseta Básica | `Ropa` | 1990 | $19.90 | 20 |

`PROD-005` tiene stock 3 a propósito: es el producto con el que se demuestra en vivo el
rechazo por stock insuficiente.

## Cupones registrados

| código | tipo | tasa | estado | propósito |
|--------|------|------|--------|-----------|
| `WELCOME2026` | porcentaje | 15% | activo | El cupón básico |
| `SUMMER2024` | porcentaje | 20% | **expirado** | Caso borde de cupón expirado |
| `DEMOCAP50` | porcentaje | 50% | activo, **extensión de demo** | Único camino para disparar la alerta de descuento límite alcanzado  |

`DEMOCAP50` existe porque el tope del 35%
es inalcanzable con las reglas literales (ver `architecture.md`), y es necesario para demostrar la
alerta. Debe estar marcado como extensión en el código y en `docs/arquitectura.md`.

Un código no registrado y uno expirado se tratan igual: **se ignoran sin lanzar excepción**
y el resto de la cascada continúa. El desglose reporta la línea de cupón con
`applied: false`.

## Umbrales

- **Volumen:** se activa cuando el subtotal tras la regla de categoría es
  **estrictamente mayor** a `10000` centavos. Exactamente `10000` **no** activa el 5%
  ("supera los $100 USD" es `>`, no `>=`).
- **Tope absoluto:** `3500` puntos básicos, es decir el 35% del subtotal original.

## Política de redondeo

Regla única: **la cascada se calcula sin redondear y el redondeo ocurre una sola vez, al
final.** Redondear en cada paso acumula error, hace que el resultado dependa del orden de
las operaciones y produce descuadres de centavos entre lo que muestra el frontend y lo que
persiste el backend.

### Aritmética exacta durante la cascada

Las entradas son centavos enteros, pero la cascada multiplicativa produce fracciones de
centavo (`9975 × 0.85 = 8478.75`). Para no introducir punto flotante, la cascada opera en
**micro-centavos**: enteros con escala `MICRO = 1_000_000`.

```ts
export const MICRO = 1_000_000;
export const toMicros = (cents: number): number => cents * MICRO;
```

Cada tasa se aplica como fracción entera en **puntos básicos**, nunca como float:

| regla | tasa | bps | operación sobre micros |
|-------|------|-----|------------------------|
| Categoría | 10% | `1000` | `× 1000 / 10000` |
| Volumen | 5% | `500` | `× 500 / 10000` |
| Cupón | 15% | `1500` | `× 1500 / 10000` |

Con `MICRO = 1_000_000` las tres divisiones son **exactas** a lo largo de toda la cascada:
los denominadores acumulados son 10, 20 y 20, y su producto (4000) divide a 1.000.000.
Ningún paso intermedio se redondea ni se trunca.

Cota de rango: la escala es segura mientras el subtotal no supere ~9.000.000.000 centavos
(~$90M) frente a `Number.MAX_SAFE_INTEGER`. Excede por varios órdenes de magnitud el
catálogo, pero queda documentada.

### El único redondeo

```ts
// Todos los montos son positivos, así que Math.round es half-up sin ambigüedad de signo.
export const roundHalfUp = (micros: number): number => Math.round(micros / MICRO);
```

1. La cascada produce `rawDiscountMicros`, exacto.
2. `rawDiscountCents = roundHalfUp(rawDiscountMicros)`. **Este es el único redondeo de todo
   el cálculo.**
3. Tope: `capCents = Math.floor(originalSubtotalCents * 3500 / 10000)`. Floor, nunca ceil:
   el descuento no puede *superar* el 35%, y redondear hacia arriba lo violaría por un
   centavo.
4. `totalSavingsCents = Math.min(rawDiscountCents, capCents)` y
   `capApplied = rawDiscountCents > capCents`.
5. `finalTotalCents = originalSubtotalCents - totalSavingsCents`. Se **deriva**, nunca se
   calcula por separado: así no puede desincronizarse del desglose.

### Líneas del desglose

Cada `DiscountLine` conserva su monto exacto en micro-centavos. Su valor en centavos es
solo para presentación y se reparte con **mayor resto**, de modo que las líneas sumen
exactamente `rawDiscountCents`:

- se toma `Math.floor(discountMicros / MICRO)` por línea,
- la diferencia contra `rawDiscountCents` se reparte de a un centavo, empezando por las
  líneas de mayor resto fraccionario.

Así el desglose que ve el usuario suma exactamente el ahorro reportado, sin el descuadre
clásico de un centavo. Cuando el tope se activa, las líneas siguen sumando
`rawDiscountCents` y la diferencia contra `totalSavingsCents` es precisamente el
truncamiento, que la UI presenta como tal.

### Consistencia frontend / backend

La política tiene **una sola implementación**, en `packages/shared`, y es la que usan el
backend, el frontend y los tests. No se replica ni se reimplementa:

- El frontend **no recalcula descuentos ni vuelve a redondear montos calculados**. Recibe
  `CheckoutTotals` con todos los valores ya en centavos enteros desde
  `POST /api/checkout/preview` y únicamente los formatea.
- El formateo a USD también es compartido (`formatCents` en `packages/shared`), para que el
  mismo monto se pinte idéntico en el carrito, en el desglose y en la confirmación.
- Prohibido `toFixed()` sobre un monto calculado en el frontend: es un redondeo paralelo,
  fuera de la política, y es la vía exacta por la que la UI y la orden persistida terminan
  difiriendo en un centavo.
- La única aritmética de dinero permitida en el frontend es `precioCentavos × cantidad`
  para el subtotal optimista del carrito de compras: producto de enteros, exacto, sin redondeo.

Nunca uses punto flotante para representar dinero. En la cascada no aparece ningún float:
las tasas son enteros en puntos básicos.

## Contrato de la API

REST bajo `/api`. Los tipos viven en `packages/shared` y se importan en ambos lados.

```ts
type DiscountName = 'CATEGORY' | 'VOLUME' | 'COUPON';

interface DiscountLine {
  name: DiscountName;
  label: string;              // texto ya listo para la UI
  applied: boolean;           // false cuando la regla no era aplicable
  rateBps: number;            // 1000 | 500 | 1500 (puntos básicos, entero)
  baseAmountMicros: number;   // monto exacto sobre el que operó la regla
  baseAmountCents: number;    // derivado, SOLO presentación; no se opera con él
  discountMicros: number;     // monto exacto de la regla, sin redondear
  discountCents: number;      // reparto por mayor resto; suma = rawDiscountCents
}

interface CheckoutTotals {
  originalSubtotalCents: number;
  lines: DiscountLine[];          // siempre las 3, en orden de precedencia
  rawDiscountMicros: number;      // cascada exacta, ANTES de redondear y de topar
  rawDiscountCents: number;       // rawDiscountMicros redondeado: el único redondeo
  capCents: number;               // floor(originalSubtotal * 3500 / 10000)
  capApplied: boolean;            // true solo si rawDiscountCents excedió capCents
  totalSavingsCents: number;      // descuento final, ya topado
  effectiveDiscountBps: number;   // round(totalSavings * 10000 / originalSubtotal)
  finalTotalCents: number;
}
```

`lines` incluye siempre las tres reglas, aplicadas o no. La UI necesita mostrar el desglose
completo, no solo lo que aplicó.

Los campos `*Micros` son los valores exactos de la cascada y viajan en la respuesta para que
el desglose sea auditable y los tests puedan afirmar sobre el cálculo sin redondeo. Los
campos `*Cents` son el resultado de la política de redondeo y son los que la UI muestra. El
frontend nunca opera aritméticamente con los micros: solo los usa quien testea.

### Petición de checkout y confirmación de la orden

El mismo cuerpo sirve a `preview` y a `checkout`. El cliente declara **qué** quiere comprar
y con qué cupón, nunca montos: no hay campo de subtotal, descuento ni total, y esa ausencia
es lo que hace estructuralmente cierto que el backend sea la única fuente de verdad del
cálculo.

```ts
interface CheckoutRequest {
  readonly items: readonly CartItem[];
  readonly couponCode?: string;   // ausente = sin cupón (exactOptionalPropertyTypes)
}
```

La respuesta de `POST /api/checkout` es un contrato propio, porque un cálculo y un hecho
persistido no son el mismo tipo:

```ts
interface OrderConfirmationItem {
  readonly productId: string;
  readonly name: string;            // del catálogo leído; la fila OrderItem no lo almacena
  readonly category: ProductCategory;  // literal sin tilde; la tilde vive en CATEGORY_LABEL
  readonly quantity: number;        // entero positivo
  readonly unitPriceCents: number;  // de la orden persistida: el monto efectivamente cobrado
  readonly lineTotalCents: number;  // unitPriceCents × quantity, producto de enteros
}

interface OrderConfirmation {
  readonly orderId: string;
  readonly createdAt: string;       // ISO-8601, nunca Date: es lo que cruza el cable
  readonly couponCode?: string;     // ausente = sin cupón; ni undefined ni el null de Prisma
  readonly items: readonly OrderConfirmationItem[];
  readonly totals: CheckoutTotals;  // embebido, no aplanado
}
```

Tres decisiones del contrato que no son estéticas:

- `totals` **embebe** `CheckoutTotals` en lugar de aplanarlo. Una sola declaración de la
  forma del desglose sirve a `preview` y a `checkout`, y el componente de desglose del
  frontend vale para ambos sin ramas.
- El campo de líneas se llama `items` y no `lines`, porque `CheckoutTotals.lines` ya son las
  `DiscountLine[]` del desglose. Dos `lines` con significados distintos en la misma
  respuesta sería una confusión garantizada.
- `createdAt` es cadena ISO-8601 y `couponCode` es opcional **ausente**. El contrato
  describe lo que queda tras `JSON.stringify`, no el tipo que devuelve el ORM ni el `null`
  de la columna; traducir entre ambos es responsabilidad del mapeo.

Los precios unitarios se congelan en la orden persistida a propósito: la orden sigue siendo
auditable si el precio del catálogo cambia después.

La forma de los detalles del `409` por stock también es un tipo compartido, para que quien
produce el error y quien lo renderiza lean la misma estructura sin redeclararla:

```ts
interface StockShortage {
  readonly productId: string;
  readonly requested: number;
  readonly available: number;
}
```

Los cuatro contratos —`CheckoutRequest`, `OrderConfirmationItem`, `OrderConfirmation` y
`StockShortage`— viven en `packages/shared` junto a `CheckoutTotals` y se importan en ambos
lados. El DTO decorado con class-validator del backend declara
`implements CheckoutRequest`, de modo que `tsc` verifica en compilación que la clase
validada no se separe del contrato que el frontend consume.

### Endpoints

| método | ruta | estado | cuerpo de respuesta | propósito |
|--------|------|--------|---------------------|-----------|
| `GET` | `/api/products` | `200` | `Product[]` | Catálogo con stock actual (Gestión del Carrito) |
| `POST` | `/api/checkout/preview` | `200` | `CheckoutTotals` | Calcula el desglose. No valida stock, no persiste, no decrementa (Aplicación Dinámica de Cupón y Visualización de Desglose) |
| `POST` | `/api/checkout` | `201` | `OrderConfirmation` | Valida stock, recalcula, decrementa stock, persiste la orden (Procesamiento Consistente de la Orden) |

Ambos endpoints de checkout reciben `CheckoutRequest` como cuerpo. El `200` de `preview` se
declara de forma explícita, porque el valor por defecto de Nest para un `@Post()` es `201`:
`preview` no crea nada, así que devolver `201` sería mentir sobre el efecto de la llamada.
El `201` de `checkout` sí es correcto, y ahí el recurso creado es la orden.

`preview` existe para que el frontend muestre el desglose en vivo sin efectos secundarios,
manteniendo el backend como única fuente de verdad del cálculo. El frontend **nunca**
calcula descuentos por su cuenta.

`checkout` recalcula con el mismo motor sobre el catálogo persistido y no lee ningún monto
del cliente: un mismo carrito y un mismo cupón producen montos idénticos en centavos en
ambos endpoints.

### Forma de error

```ts
interface ApiError {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

type ErrorCode =
  | 'INSUFFICIENT_STOCK'   // 409
  | 'PRODUCT_NOT_FOUND'    // 404
  | 'INVALID_CART'         // 400
  | 'INTERNAL_ERROR';      // 500, extensión de infraestructura
```

Un cupón desconocido o expirado **no** es un error: se ignora (ver arriba).

#### Los dos `409` de stock

`INSUFFICIENT_STOCK` se emite desde dos puntos distintos de `POST /api/checkout`, con el
mismo código y **detalles distintos**. Que difieran es correcto: describen situaciones
distintas y el usuario reacciona distinto ante cada una.

| origen | mensaje | detalles | significado |
|--------|---------|----------|-------------|
| Validación contra el snapshot del catálogo | `Alguna linea del carrito supera el stock disponible.` | `shortages: StockShortage[]` | "pediste 5 y hay 3" — el usuario corrige el carrito |
| Guarda del decremento condicional | `El stock cambio mientras se confirmaba la compra.` | `contendedProductIds: string[]` | "alguien se llevó las unidades mientras comprabas" — reintentar |

La validación agrega las cantidades por producto y reporta **todas** las líneas
deficitarias, no solo la primera, en orden ascendente por `productId` para que la respuesta
sea determinista. Rechaza únicamente cuando la cantidad supera **estrictamente** el stock:
una cantidad igual al disponible se trata como satisfecha.

La guarda del decremento no puede reportar `StockShortage[]`: el compare-and-swap sabe que
la fila ya no cumplía la condición, pero no cuánto stock quedaba, y releerlo daría un valor
igual de obsoleto. Por eso sus detalles son solo los identificadores en disputa.

En ambos casos el `409` deja el stock sin modificar y no persiste orden ni línea de orden.

## Alerta del tope

Texto exacto, sin variaciones:

```
¡Enhorabuena! Has alcanzado el límite máximo de ahorro permitido (35%)
```

Se muestra **si y solo si `capApplied === true`**, es decir cuando el descuento crudo
superó estrictamente el tope y hubo truncamiento. Un descuento de exactamente 35% no
dispara la alerta.

`capApplied` lo decide el backend y viaja en la respuesta. El frontend no re-deriva la
condición comparando porcentajes.

La notificación es persistente: permanece visible mientras la condición se cumpla, no es un
toast que se desvanece.
