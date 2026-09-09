# Requirements Document

## Introduction

Vocabulario compartido de `packages/shared`: los contratos del dominio que API y UI intercambian,
el seed canónico de catálogo y cupones, y las utilidades de dinero en aritmética entera.

Ninguna de las tres piezas contiene reglas de negocio. Son lo que hace que las reglas se puedan
escribir una sola vez: el tipo que el motor produce, los datos con los que se prueba y la
aritmética con la que se calcula.

**Cadena de specs:** `monorepo-foundation` → `shared-contracts-seed` → `discount-engine`.
Referencias entre specs con prefijo (`MF-`, `SCS-`, `DE-`); dentro del documento, `R2.4` es
"Requerimiento 2, criterio 4". Criterios en EARS.

**Hereda de `monorepo-foundation`** y no lo repite: cero dependencias de runtime y cero imports
de framework (`MF-R2.1`), cero `any` y cero assertions salvo `as const` (`MF-R2.4`), conjuntos
cerrados derivados de `as const` (`MF-R2.3`), `tsc --noEmit` limpio y `lint` que falla con
archivo y línea (`MF-R2.2`, `MF-R2.6`).

**Fuera de alcance:** estrategias, factory, motor, cascada y ensamblador, que son de
`discount-engine`. Aquí se declara la *forma* de `ErrorCode` y `ApiError`; quién lanza y en qué
orden es `DE-R5`. `INSUFFICIENT_STOCK` se declara aunque lo emita el backend, porque el contrato
de error es compartido.

**Fuente de los datos:** el catálogo, los cupones y las categorías son canónicos en
`.kiro/steering/product-rules.md`. Este documento no los reproduce, los referencia: los criterios
fijan estructura, invariantes y resolución; la tabla de seis productos y tres cupones vive en el
steering y solo ahí.

## Requirements

### Requerimiento 1: Contratos del dominio como única fuente de verdad

**User Story:** Como desarrollador, quiero los contratos publicados desde un solo paquete, para
que la API y la UI compartan exactamente los mismos tipos.

#### Acceptance Criteria

1. EL Paquete_Shared DEBERÁ exportar `PRODUCT_CATEGORIES` como
   `['Tecnologia', 'Hogar', 'Ropa'] as const` —los tres literales sin tilde, en ese orden— y
   derivar `ProductCategory` como `(typeof PRODUCT_CATEGORIES)[number]`, sin escribir la unión a
   mano.
2. EL Paquete_Shared DEBERÁ exportar `CATEGORY_LABEL: Record<ProductCategory, string>` con los
   pares `Tecnologia → 'Tecnología'`, `Hogar → 'Hogar'`, `Ropa → 'Ropa'`, de modo que la clave sea
   el literal sin tilde y la tilde exista solo en el valor.
3. EL Paquete_Shared DEBERÁ exportar `Product` con exactamente `id: string`, `name: string`,
   `category: ProductCategory`, `priceCents: number` y `stock: number`, donde los dos numéricos
   son enteros no negativos declarados como `number`, nunca como `string` ni con punto flotante.
4. EL Paquete_Shared DEBERÁ exportar `CartItem` con exactamente `productId: string` y
   `quantity: number` entero mayor o igual a `1`.
5. EL Paquete_Shared DEBERÁ exportar `DiscountName` como la unión cerrada
   `'CATEGORY' | 'VOLUME' | 'COUPON'`, en ese orden de precedencia.
6. EL Paquete_Shared DEBERÁ exportar `DiscountLine` con exactamente `name: DiscountName`,
   `label: string` no vacío listo para la UI, `applied: boolean`, `rateBps` entero de `0` a
   `10000`, `baseAmountMicros`, `baseAmountCents`, `discountMicros` y `discountCents`, todos
   enteros no negativos.
7. EL Paquete_Shared DEBERÁ exportar `CheckoutTotals` con exactamente `originalSubtotalCents`,
   `lines: DiscountLine[]`, `rawDiscountMicros`, `rawDiscountCents`, `capCents`,
   `capApplied: boolean`, `totalSavingsCents`, `effectiveDiscountBps` y `finalTotalCents`, con
   todos los numéricos enteros no negativos; y `ErrorCode` como
   `'INSUFFICIENT_STOCK' | 'PRODUCT_NOT_FOUND' | 'INVALID_CART'` junto a `ApiError` con la forma
   `{ error: { code: ErrorCode; message: string; details?: Record<string, unknown> } }`, sin usar
   `any`.
8. SI un consumidor declara un valor de estos contratos con un campo ausente, adicional o de tipo
   distinto, o asigna a `ProductCategory` la cadena `'Tecnología'` con tilde, ENTONCES `tsc
   --noEmit` DEBERÁ rechazar la compilación señalando el campo, de modo que la divergencia de
   tilde no pueda pasar en silencio.

### Requerimiento 2: Seed canónico de catálogo y cupones

**User Story:** Como desarrollador, quiero el catálogo y los cupones definidos una sola vez, para
que el seed de la base de datos y los tests del motor usen idénticos valores.

#### Acceptance Criteria

1. EL Seed DEBERÁ contener exactamente los seis productos y los tres cupones declarados en
   `product-rules.md`, con valores idénticos de id, nombre, categoría, precio en centavos, stock,
   código, tasa y estado; ids y códigos únicos, precios en centavos enteros positivos, stock
   entero no negativo y categoría tomada de `ProductCategory`.
2. EL Seed DEBERÁ expresar toda tasa de cupón como entero en puntos básicos de `0` a `10000`, sin
   parte fraccionaria, y el estado como unión cerrada de activo y expirado derivada de `as const`.
3. EL Seed DEBERÁ exponer la condición de extensión de demo como campo booleano tipado, en `true`
   solo para el cupón que `product-rules.md` marca como extensión, con un comentario en el código
   que declare su propósito.
4. CUANDO un consumidor resuelve un código de cupón registrado, EL Seed DEBERÁ devolverlo con su
   código, tasa, estado y marca de extensión, por comparación exacta y sensible a mayúsculas, sin
   normalizar ni recortar la entrada, **incluido el caso de estado expirado**.
5. SI el código de cupón no figura en el registro o está vacío, o SI se resuelve un `productId`
   ausente del catálogo, ENTONCES EL Seed DEBERÁ indicar la ausencia con un valor tipado, sin
   lanzar excepción y sin modificar el registro.
6. SI un valor del Seed deja de satisfacer `Product` o `Coupon` —un precio como cadena, una
   categoría con tilde, una tasa fuera del rango de bps—, ENTONCES `tsc` DEBERÁ rechazar la
   compilación señalando la entrada, sin recurrir a una assertion que lo silencie.

### Requerimiento 3: Utilidades de dinero en aritmética entera

**User Story:** Como desarrollador, quiero la aritmética de dinero centralizada en enteros, para
que ningún consumidor introduzca punto flotante ni un redondeo paralelo.

#### Acceptance Criteria

1. EL Módulo_Dinero DEBERÁ exportar `MICRO` como entero `1_000_000` y `toMicros(c)` que devuelve
   `c × MICRO` para centavos enteros de `0` a `9_000_000_000`, sin punto flotante.
2. EL Módulo_Dinero DEBERÁ exportar `roundHalfUp(m)`, que devuelve el entero de centavos más
   cercano a `m / MICRO` resolviendo el empate hacia arriba, de modo que `5845500000` devuelve
   `5846` y `18835500000` devuelve `18836`.
3. EL Módulo_Dinero DEBERÁ exportar `applyBps(amountMicros, bps)` que aplica la tasa como
   `× bps / 10000` con `bps` entero, sin literales de punto flotante.
4. EL Módulo_Dinero DEBERÁ exportar `formatCents`, que para centavos enteros devuelve `$`, la
   parte entera agrupada de a tres con `,` y dos decimales: `129900` → `$1,299.00`, `0` →
   `$0.00`, `1990` → `$19.90`, `100000000` → `$1,000,000.00`, sin `toFixed` sobre el monto.
5. EL Módulo_Dinero DEBERÁ exportar un reparto por mayor resto que, dada una lista de montos en
   micro-centavos y un total objetivo en centavos, devuelve una lista de igual longitud y orden
   cuya suma iguala exactamente el objetivo, sin mutar la entrada.
6. CUANDO el reparto asigna los sobrantes, DEBERÁ partir del piso `Math.floor(m / MICRO)` de cada
   posición y asignar un centavo por vez a las de mayor resto `m mod MICRO` en orden descendente;
   ante restos iguales DEBERÁ ganar la posición de menor índice, de modo que sea determinista.
7. CUANDO el reparto recibe una lista vacía con objetivo `0`, DEBERÁ devolver una lista vacía sin
   lanzar excepción.
8. EL Módulo_Dinero DEBERÁ devolver todo monto como entero verificable con `Number.isInteger`, y
   DEBERÁ tratar sus funciones como puras **sin validación de entrada**, asumiendo que el
   objetivo del reparto es consistente con la lista recibida; la validación del carrito reside en
   el motor (`DE-R5`).
