# Design Document

## Overview

Puebla tres de las cuatro carpetas de `packages/shared/src/`: `domain/` (contratos sin lógica),
`seed/` (datos canónicos) y `money/` (aritmética pura sin conocimiento del dominio). La cuarta,
`discount/`, es de la spec siguiente.

**Principio rector: un dato, una definición.** Las categorías se derivan de un arreglo `as const`
en lugar de escribirse como unión; el catálogo vive en un módulo que el backend importará en vez
de duplicar; la tabla de valores vive en `product-rules.md` y este diseño la referencia. Cada
copia evitada es una deriva que no puede ocurrir.

## Architecture

```
packages/shared/src/
├── index.ts                      # fachada pública
├── domain/
│   ├── categories.ts             # PRODUCT_CATEGORIES, ProductCategory, CATEGORY_LABEL (R1.1, R1.2)
│   ├── product.ts                # Product, CartItem (R1.3, R1.4)
│   ├── coupon.ts                 # COUPON_STATUSES, CouponStatus, Coupon (R2.2, R2.3)
│   ├── discount.contracts.ts     # DISCOUNT_NAMES, DiscountName, DiscountLine, CheckoutTotals (R1.5-R1.7)
│   └── errors.ts                 # ERROR_CODES, ErrorCode, ApiError (R1.7)
├── seed/
│   ├── catalog.seed.ts           # CATALOG_PRODUCTS, findProductById (R2.1, R2.5)
│   └── coupons.seed.ts           # COUPONS, findCouponByCode (R2.1-R2.5)
└── money/
    ├── micro.ts                  # MICRO, toMicros, roundHalfUp, applyBps (R3.1-R3.3)
    ├── allocate.ts               # allocateByLargestRemainder (R3.5-R3.7)
    └── format.ts                 # formatCents (R3.4)
```

`money/` no depende de nada: no conoce productos, ni cupones, ni descuentos. `domain/` tampoco
depende de `money/` —los contratos declaran `number`—. `seed/` depende solo de `domain/` para
verificarse contra él. Esa ausencia de acoplamiento es lo que permite a `discount-engine`
construirse encima sin tocar nada de lo entregado aquí.

## Components and Interfaces

Firmas, no cuerpos: el diseño fija el contrato y el porqué; el cómo es de la implementación.

### `domain/categories.ts` (R1.1, R1.2)

```ts
export const PRODUCT_CATEGORIES = ['Tecnologia', 'Hogar', 'Ropa'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<ProductCategory, string>;
// Tecnologia → 'Tecnología' | Hogar → 'Hogar' | Ropa → 'Ropa'
```

La clave es el literal **sin tilde** y la tilde vive solo en el valor, así que asignar
`'Tecnología'` a un `ProductCategory` es error de compilación (R1.8). Esta separación es la
defensa contra un fallo silencioso concreto: la comparación de `DE-R1.4` es contra el literal, y
comparar contra la etiqueta no daría error — solo un descuento que deja de aplicarse sin que
ningún test obvio lo detecte.

### `domain/` — contratos (R1.3–R1.7)

```ts
export interface Product  { readonly id: string; readonly name: string;
                            readonly category: ProductCategory;
                            readonly priceCents: number; readonly stock: number; }
export interface CartItem { readonly productId: string; readonly quantity: number; }

export const COUPON_STATUSES = ['active', 'expired'] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];
export interface Coupon { readonly code: string; readonly rateBps: number;
                          readonly status: CouponStatus; readonly isDemoExtension: boolean; }

export const DISCOUNT_NAMES = ['CATEGORY', 'VOLUME', 'COUPON'] as const;  // orden = precedencia
export type DiscountName = (typeof DISCOUNT_NAMES)[number];

export interface DiscountLine {
  name: DiscountName; label: string; applied: boolean;
  rateBps: number;            // entero 0..10000
  baseAmountMicros: number;   // exacto
  baseAmountCents: number;    // derivado, SOLO presentación
  discountMicros: number;     // exacto, sin redondear
  discountCents: number;      // reparto por mayor resto; suma = rawDiscountCents
}

export interface CheckoutTotals {
  originalSubtotalCents: number;
  lines: DiscountLine[];          // 3 cuando el motor se arma desde el factory
  rawDiscountMicros: number;      // cascada exacta, antes de redondear y de topar
  rawDiscountCents: number;       // el único redondeo
  capCents: number;               // floor(originalSubtotal * 3500 / 10000)
  capApplied: boolean;            // true solo si rawDiscountCents > capCents
  totalSavingsCents: number;      // ya topado
  effectiveDiscountBps: number;
  finalTotalCents: number;        // derivado: originalSubtotal - totalSavings
}

export const ERROR_CODES = ['INSUFFICIENT_STOCK', 'PRODUCT_NOT_FOUND', 'INVALID_CART'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface ApiError {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}
```

"Entero no negativo" y "cadena no vacía" no son expresables en el tipo estructural; se garantizan
por el seed (verificado en compilación, R2.6) y por la validación en runtime del motor (`DE-R5`),
y se afirman en los tests con `Number.isInteger`.

El orden de `DISCOUNT_NAMES` **es** la precedencia de la cascada, y de ahí lo toman la factory
(`DE-R2.1`) y el desempate del reparto (`DE-R4.8`). `isDemoExtension` es campo del contrato y no
un comentario porque `DE-R6.8` lo consulta para excluir el cupón de demo de un test.

### `seed/` (R2)

```ts
export const CATALOG_PRODUCTS: readonly Product[];   // 6 entradas, valores según product-rules.md
export const COUPONS: readonly Coupon[];             // 3 entradas, valores según product-rules.md
export const findProductById: (id: string, catalog?: readonly Product[]) => Product | undefined;
export const findCouponByCode: (code: string) => Coupon | undefined;
```

**Los valores no se reproducen aquí.** Están en `product-rules.md`, que es su fuente canónica, y
el implementador los transcribe desde ahí una sola vez.

**Forma de declaración (R2.6):** `[...] as const satisfies readonly Product[]`. `as const`
estrecha (permitido y preferido) y `satisfies` **verifica** contra el contrato sin ensanchar. La
alternativa `as readonly Product[]` sería una assertion —prohibida por `MF-R2.4`— y además
afirmaría sin comprobar. Con `satisfies`, un precio que cambie a `string` rompe la compilación en
la línea exacta.

`findCouponByCode` devuelve el cupón **también cuando está expirado** (R2.4): la decisión de
ignorarlo es de la estrategia (`DE-R1.8`), no del registro. El registro informa, no juzga; si
ocultara el expirado, "no existe" y "existe pero venció" serían indistinguibles.

`findProductById` acepta un catálogo opcional porque el motor resuelve contra el catálogo que
recibe en su input, no contra el seed global (`DE-R5.3`), y los tests necesitan catálogos a
medida.

### `money/` (R3)

```ts
export const MICRO = 1_000_000;
export const MAX_SUBTOTAL_CENTS = 9_000_000_000;  // cota frente a MAX_SAFE_INTEGER
export const toMicros:    (cents: number) => number;
export const roundHalfUp: (micros: number) => number;   // único redondeo autorizado
export const applyBps:    (amountMicros: number, bps: number) => number;
export const formatCents: (cents: number) => string;
export const allocateByLargestRemainder:
  (amountsMicros: readonly number[], targetCents: number) => number[];
```

`roundHalfUp` es `Math.round(micros / MICRO)`: todos los montos son positivos, así que es half-up
sin la ambigüedad de signo que habría con negativos.

`applyBps` divide y aun así da entero exacto en toda la cascada de producción: los denominadores
acumulados de las tres tasas son 10, 20 y 20, y su producto (4000) divide a `1.000.000`. Esa
propiedad es lo que permite a `DE-R3.2` prohibir el redondeo intermedio sin perder precisión.

`allocateByLargestRemainder` parte del piso de cada posición y reparte el sobrante de a un centavo
por mayor resto, con **desempate por menor índice** (R3.6): con las estrategias del factory el
orden de índice es exactamente `CATEGORY`, `VOLUME`, `COUPON`, así que el reparto es determinista.

`formatCents` agrupa la parte entera con `Intl.NumberFormat` **sobre un entero** y concatena los
dos decimales como cadena desde `cents % 100`. Nunca formatea un float ni usa `toFixed`: `toFixed`
redondea, y un redondeo en presentación sería un segundo punto de redondeo en un sistema que
declara tener uno solo. Es dueño único del formateo para todo el monorepo, así que el mismo monto
se pinta idéntico en carrito, desglose y confirmación.

`MAX_SUBTOTAL_CENTS` se declara aquí pero se hace cumplir en el motor (`DE-R5.6`), coherente con
que `money/` no valide (R3.8).

## Error Handling

Esta spec declara la forma del error y no lanza ninguno.

| Módulo | Ante entrada inesperada | Por qué |
|--------|-------------------------|---------|
| `domain/` | No aplica: son tipos | — |
| `seed/` | Devuelve `undefined` (R2.5) | Un cupón inexistente o expirado es caso legítimo, no fallo: la cascada continúa e ignora la línea (`DE-R5.4`) |
| `money/` | No valida (R3.8) | Son funciones puras invocadas por el motor, que ya validó |

`DiscountDomainError` y el orden de validación se especifican en `DE-R5`.

## Testing Strategy

Primeras pruebas reales del arnés. Deterministas, montos fijos en centavos enteros, sin API, sin
base de datos, sin red.

```
domain/contracts.spec.ts   seed/seed.spec.ts
money/micro.spec.ts        money/allocate.spec.ts        money/format.spec.ts
```

| Test | Afirma | Req |
|------|--------|-----|
| Empate de redondeo | `roundHalfUp(5845500000) === 5846`, `roundHalfUp(18835500000) === 18836` | R3.2 |
| Desempate del reparto | Dos posiciones con idéntico resto → el centavo va a la de menor índice | R3.6 |
| Reparto vacío | `[]` con objetivo `0` → `[]`, sin excepción | R3.7 |
| Seed contra el steering | Los seis productos y tres cupones coinciden con `product-rules.md` | R2.1 |
| Cupón expirado se devuelve | `findCouponByCode` del expirado devuelve el cupón, no `undefined` | R2.4 |
| Cupón ausente / vacío | Ambos devuelven `undefined` sin lanzar | R2.5 |
| Formateo | `129900 → '$1,299.00'`, `0 → '$0.00'`, `1990 → '$19.90'`, `100000000 → '$1,000,000.00'` | R3.4 |
| Enteros | Cada retorno de `toMicros`, `roundHalfUp`, `applyBps` y el reparto pasa `Number.isInteger` | R3.8 |

R1.8 es un fallo de **compilación**, no de ejecución: se verifica observando el código de salida
de `tsc --noEmit` sobre un fixture que debe fallar, no con `@ts-expect-error`, que está prohibido.

## Design Decisions

**Micro-centavos con `number`, no `bigint` ni librería decimal.** La cascada produce fracciones de
centavo (`9975 × 0.85 = 8478.75`) y necesita exactitud. Los enteros escalados por `MICRO` la dan
de forma *demostrable*: los denominadores acumulados (10, 20, 20) multiplican 4000, que divide a
1.000.000. `bigint` contaminaría el contrato de API —no es serializable por `JSON.stringify`— y
obligaría a conversiones en cada frontera; una librería decimal añadiría una dependencia de
runtime a un paquete que declara cero.

**La tabla de valores no se repite en la spec.** `product-rules.md` es steering con
`inclusion: always`: está en contexto en toda sesión. Reproducir los seis productos en los
criterios y otra vez en el diseño crea tres copias que coinciden solo mientras nadie edite
ninguna. Un criterio que dice "exactamente los seis productos declarados en `product-rules.md`" es
igual de verificable y no puede divergir.

**`money/` no valida sus entradas.** Podría comprobar que recibe enteros y lanzar. No lo hace, por
dos razones: el motor ya valida con mensajes que identifican índice y `productId`, y una segunda
validación aguas abajo daría errores peores para las mismas entradas; y cada guarda inalcanzable
es una rama que el umbral de cobertura obliga a cubrir con un test que no prueba nada real.
