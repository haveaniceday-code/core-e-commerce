# Requirements Document

## Introduction

Esta spec cubre el arranque del monorepo y la construcción completa de `packages/shared`:
los contratos del dominio, el seed del catálogo y de los cupones, las utilidades de dinero
en enteros y el motor de descuentos acumulativos con sus tres estrategias, su factory y su
suite de pruebas con umbral de cobertura propio.

`packages/shared` es la pieza central del sistema: es donde vive la matemática del
descuento, la política de redondeo y el formateo de dinero, y es el único lugar autorizado a
redondear. Todo lo que se construya después (API y UI) consume estos contratos sin
reimplementar el cálculo.

### Fuera de alcance

- `apps/backend` (NestJS, Prisma, SQLite, controllers, servicio de checkout, validación de
  stock y persistencia de órdenes).
- `apps/frontend` (React, Vite, Zustand, carrito reactivo, desglose en vivo, alerta del 35%).
- Los endpoints `GET /api/products`, `POST /api/checkout/preview` y `POST /api/checkout`.

Los patrones de workspaces de la raíz contemplan `apps/*` para que esos workspaces encajen
más adelante, pero en esta spec no se crean ni se instalan sus dependencias. Los tipos de
error `INSUFFICIENT_STOCK` y `PRODUCT_NOT_FOUND` sí se declaran aquí, porque el contrato de
error es compartido, aunque quien los emita por stock viva en el backend.

### Convención EARS de este documento

El documento está redactado en español y usa los seis patrones EARS con palabras clave
localizadas, de forma consistente:

| EARS | Palabra clave usada |
|------|---------------------|
| Ubiquitous | `EL <Sistema> DEBERÁ` |
| Event-driven | `CUANDO <disparador>, EL <Sistema> DEBERÁ` |
| State-driven | `MIENTRAS <condición>, EL <Sistema> DEBERÁ` |
| Unwanted event | `SI <condición>, ENTONCES EL <Sistema> DEBERÁ` |
| Optional feature | `DONDE <opción>, EL <Sistema> DEBERÁ` |
| Complex | `DONDE → MIENTRAS → CUANDO/SI → EL → DEBERÁ` |

## Glossary

- **Raiz_Monorepo**: el workspace raíz `core-e-commerce`, dueño de `package.json`,
  `tsconfig.base.json`, `.gitignore` y los scripts agregadores.
- **Paquete_Shared**: el workspace `packages/shared`, paquete de TypeScript puro que
  contiene contratos, seed, utilidades de dinero y motor de descuentos.
- **Contratos_Dominio**: el conjunto de tipos exportados por Paquete_Shared
  (`ProductCategory`, `Product`, `CartItem`, `DiscountName`, `DiscountLine`,
  `CheckoutTotals`, `ApiError`, `ErrorCode`).
- **Catalogo_Seed**: la estructura de datos exportada por Paquete_Shared con los seis
  productos y los tres cupones canónicos definidos en `product-rules.md`.
- **Utilidades_Dinero**: el módulo de Paquete_Shared que exporta `MICRO`, `toMicros`,
  `roundHalfUp`, `formatCents` y el reparto por mayor resto.
- **Estrategia_Descuento**: cualquier implementación de la interfaz `DiscountStrategy`
  (`CategoryDiscount`, `VolumeDiscount`, `CouponDiscount` o un stub de prueba).
- **Factory_Estrategias**: `DiscountStrategyFactory`, responsable de construir la lista
  ordenada de estrategias.
- **Motor_Descuentos**: la clase `DiscountEngine`, que recibe las estrategias por
  constructor y produce un `CheckoutTotals`.
- **Ensamblador_Totales**: la parte de Motor_Descuentos que convierte la cascada exacta en
  `CheckoutTotals`. Es el único punto del sistema autorizado a redondear.
- **Suite_Pruebas_Shared**: la suite de Vitest de Paquete_Shared y su comando
  `npm run test:cov --workspace packages/shared`.
- **Suite_Invariantes**: el subconjunto de Suite_Pruebas_Shared que verifica los invariantes
  del motor mediante generación de casos con semilla fija.
- **Compilador_TypeScript**: `tsc` ejecutado con la configuración heredada de
  `tsconfig.base.json`.
- **micro-centavo**: unidad entera de escala `MICRO = 1_000_000` respecto al centavo. Toda
  la cascada opera en micro-centavos.
- **bps**: puntos básicos enteros. Una tasa del 10% es `1000` bps y se aplica como
  `× 1000 / 10000`.
- **cascada**: la aplicación secuencial y multiplicativa de las estrategias, cada una sobre
  el remanente que dejó la anterior.
- **rawDiscountMicros**: descuento total exacto de la cascada, antes de redondear y antes de
  topar.
- **capCents**: tope absoluto del descuento, `floor(originalSubtotalCents × 3500 / 10000)`.

## Requirements

### Requerimiento 1: Raíz del monorepo con npm workspaces

**User Story:** Como desarrollador, quiero una raíz de monorepo con workspaces y una
configuración de TypeScript compartida, para que cada paquete herede el mismo tipado
estricto sin duplicar configuración.

#### Acceptance Criteria

1. LA Raiz_Monorepo DEBERÁ declarar en `package.json` el campo `workspaces` como un arreglo
   que contenga exactamente los dos patrones `apps/*` y `packages/*`, sin patrones
   adicionales.
2. LA Raiz_Monorepo DEBERÁ declarar `private: true` en `package.json`, de modo que la raíz no
   sea publicable.
3. LA Raiz_Monorepo DEBERÁ proveer `tsconfig.base.json` con `strict: true`,
   `noImplicitAny: true` y `strictNullChecks: true`, siendo este archivo la única fuente
   donde se declaran esos tres flags para todo el monorepo.
4. EL Paquete_Shared DEBERÁ extender `tsconfig.base.json` mediante el campo `extends` en su
   propio `tsconfig.json` y no DEBERÁ redeclarar `strict`, `noImplicitAny` ni
   `strictNullChecks` con valor `false`.
5. LA Raiz_Monorepo DEBERÁ listar en `.gitignore` las entradas `node_modules`, `dist`,
   `coverage` y `*.db`, de forma que tras generar esos artefactos el estado del repositorio
   no muestre ninguno de ellos como archivo sin versionar.
6. CUANDO un desarrollador ejecuta `npm run test:cov` en la Raiz_Monorepo, LA Raiz_Monorepo
   DEBERÁ ejecutar en secuencia, en el orden declarado en `workspaces`, el script `test:cov`
   de cada workspace que lo defina —en esta etapa únicamente `packages/shared`— y DEBERÁ
   terminar con código de salida cero solo si todos ellos terminan con código de salida cero.
7. SI el script de cobertura de un workspace termina con código de salida distinto de cero,
   ENTONCES LA Raiz_Monorepo DEBERÁ detener la secuencia sin ejecutar los workspaces
   restantes, emitir un mensaje que identifique el workspace que falló y terminar
   `npm run test:cov` con código de salida distinto de cero.
8. CUANDO un desarrollador ejecuta `npm install` en la Raiz_Monorepo, LA Raiz_Monorepo DEBERÁ
   resolver e instalar las dependencias de todos los workspaces declarados en una sola
   invocación y producir un único archivo de lock en la raíz.
9. SI un patrón declarado en `workspaces` no resuelve ningún paquete, como `apps/*` mientras
   esa carpeta no contenga workspaces, ENTONCES LA Raiz_Monorepo DEBERÁ omitir ese patrón y
   terminar `npm install` y `npm run test:cov` con código de salida cero.

### Requerimiento 2: Contratos del dominio como única fuente de verdad

**User Story:** Como desarrollador, quiero los contratos del dominio publicados desde un
solo paquete, para que la API y la UI compartan exactamente los mismos tipos.

#### Acceptance Criteria

1. EL Contratos_Dominio DEBERÁ exportar `PRODUCT_CATEGORIES` como la tupla de solo lectura
   `['Tecnologia', 'Hogar', 'Ropa'] as const`, con esos tres literales en ese orden, todos
   sin tilde, y DEBERÁ derivar `ProductCategory` como `(typeof PRODUCT_CATEGORIES)[number]`,
   sin volver a escribir la unión a mano.
2. EL Contratos_Dominio DEBERÁ exportar `CATEGORY_LABEL` como `Record<ProductCategory,
   string>` con exactamente tres entradas y estos pares: `Tecnologia → 'Tecnología'`,
   `Hogar → 'Hogar'`, `Ropa → 'Ropa'`, de modo que la clave sea siempre el literal sin tilde
   y la tilde exista solo en el valor de etiqueta.
3. EL Contratos_Dominio DEBERÁ exportar `Product` con exactamente los campos `id: string`,
   `name: string`, `category: ProductCategory`, `priceCents: number` y `stock: number`, donde
   `id` y `name` son cadenas no vacías, y `priceCents` y `stock` son enteros no negativos
   declarados como `number` y nunca como `string` ni como valor con punto flotante.
4. EL Contratos_Dominio DEBERÁ exportar `CartItem` con exactamente los campos
   `productId: string` y `quantity: number`, donde `productId` es una cadena no vacía y
   `quantity` es un entero mayor o igual a `1`.
5. EL Contratos_Dominio DEBERÁ exportar `DiscountName` como la unión cerrada
   `'CATEGORY' | 'VOLUME' | 'COUPON'`, sin admitir ningún otro valor y en ese orden de
   precedencia.
6. EL Contratos_Dominio DEBERÁ exportar `DiscountLine` con exactamente los campos
   `name: DiscountName`, `label: string` con texto listo para la UI, `applied: boolean`,
   `rateBps: number` entero de `0` a `10000`, `baseAmountMicros: number`,
   `baseAmountCents: number`, `discountMicros: number` y `discountCents: number`, todos ellos
   enteros no negativos.
7. EL Contratos_Dominio DEBERÁ exportar `CheckoutTotals` con exactamente los campos
   `originalSubtotalCents: number`, `lines: DiscountLine[]`, `rawDiscountMicros: number`,
   `rawDiscountCents: number`, `capCents: number`, `capApplied: boolean`,
   `totalSavingsCents: number`, `effectiveDiscountBps: number` y `finalTotalCents: number`,
   donde todos los campos numéricos son enteros no negativos que permanecen dentro de
   `Number.MAX_SAFE_INTEGER` mientras `originalSubtotalCents` no supere `9_000_000_000`.
8. EL Contratos_Dominio DEBERÁ exportar `ErrorCode` como la unión cerrada
   `'INSUFFICIENT_STOCK' | 'PRODUCT_NOT_FOUND' | 'INVALID_CART'` y `ApiError` con exactamente
   la forma `{ error: { code: ErrorCode; message: string; details?: Record<string, unknown> } }`,
   donde `message` es una cadena no vacía y `details` puede estar ausente, sin que su
   ausencia altere el resto del contrato y sin usar `any` en su tipo.
9. EL Paquete_Shared DEBERÁ exponer desde su punto de entrada público, como exportaciones
   nombradas, `PRODUCT_CATEGORIES`, `ProductCategory`, `CATEGORY_LABEL`, `Product`,
   `CartItem`, `DiscountName`, `DiscountLine`, `CheckoutTotals`, `ErrorCode` y `ApiError`, de
   modo que un consumidor los importe sin recorrer rutas internas del paquete y sin volver a
   declararlos por su cuenta.
10. SI un consumidor declara un valor de `Product`, `CartItem`, `DiscountLine`,
    `CheckoutTotals` o `ApiError` con un campo ausente, un campo adicional o un campo de tipo
    distinto al declarado, ENTONCES EL Compilador_TypeScript DEBERÁ rechazar la compilación
    con un error de tipos que identifique el campo en cuestión, y `tsc --noEmit` DEBERÁ
    terminar con código de salida distinto de cero sin emitir artefactos.
11. SI un consumidor intenta asignar a un valor de tipo `ProductCategory` la cadena
    `'Tecnología'` con tilde, o cualquier cadena ausente de `PRODUCT_CATEGORIES`, ENTONCES EL
    Compilador_TypeScript DEBERÁ rechazar la asignación con un error de tipos, de modo que la
    divergencia de tilde no pueda pasar en silencio.

### Requerimiento 3: Seed canónico de catálogo y cupones

**User Story:** Como desarrollador, quiero el catálogo y los cupones definidos una sola vez
en `packages/shared`, para que el seed de la base de datos y los tests del motor usen
idénticos valores.

#### Acceptance Criteria

1. EL Catalogo_Seed DEBERÁ contener exactamente seis productos, con identificadores únicos,
   precios en centavos enteros positivos, stock en unidades enteras mayores o iguales a cero
   y categoría tomada de la unión cerrada `'Tecnologia' | 'Hogar' | 'Ropa'` (literales sin
   tilde), con estos valores exactos: `PROD-001` / `Laptop Pro 14"` / `Tecnologia` /
   `129900` / stock `5`; `PROD-002` / `Auriculares Bluetooth` / `Tecnologia` / `7990` /
   stock `12`; `PROD-003` / `Teclado Mecánico` / `Tecnologia` / `4550` / stock `8`;
   `PROD-004` / `Lámpara de Escritorio` / `Hogar` / `3200` / stock `15`; `PROD-005` /
   `Juego de Sábanas` / `Hogar` / `5900` / stock `3`; `PROD-006` / `Camiseta Básica` /
   `Ropa` / `1990` / stock `20`.
2. EL Catalogo_Seed DEBERÁ contener exactamente tres cupones, con códigos únicos y estado
   tomado de una unión cerrada de estados activo y expirado: `WELCOME2026` con `1500` bps y
   estado activo, `SUMMER2024` con `2000` bps y estado expirado, y `DEMOCAP50` con `5000`
   bps, estado activo y marca de extensión de demo en `true`.
3. EL Catalogo_Seed DEBERÁ expresar toda tasa de cupón como entero en puntos básicos dentro
   del rango `0` a `10000` inclusive, sin valores con parte fraccionaria ni representaciones
   en punto flotante.
4. EL Catalogo_Seed DEBERÁ exponer la condición de extensión ajena al enunciado de
   `DEMOCAP50` como campo tipado booleano consultable por los consumidores, con valor `false`
   para `WELCOME2026` y `SUMMER2024`, y DEBERÁ acompañarla de un comentario en el código que
   declare su propósito.
5. CUANDO un consumidor resuelve un código de cupón que figura en el registro, EL
   Catalogo_Seed DEBERÁ devolver ese cupón con su código, tasa en bps, estado y marca de
   extensión tal como están definidos, usando comparación exacta y sensible a mayúsculas y
   minúsculas, sin normalizar ni recortar el código recibido, incluido el caso de estado
   expirado.
6. SI el código de cupón consultado no figura en el registro, o está vacío, ENTONCES EL
   Catalogo_Seed DEBERÁ indicar la ausencia del cupón mediante un valor tipado de ausencia,
   sin lanzar excepción y sin modificar el registro.
7. EL Catalogo_Seed DEBERÁ ser la única definición de estos valores en el monorepo, sin
   literales duplicados de identificador, precio, stock, código o tasa fuera de ella.
8. SI se resuelve un identificador de producto que no figura en el catálogo, ENTONCES EL
   Catalogo_Seed DEBERÁ indicar la ausencia del producto mediante un valor tipado de
   ausencia, sin lanzar excepción.

> **Nota (no es criterio verificable de esta spec):** la condición de extensión de demo de
> `DEMOCAP50` también se describe en `docs/arquitectura.md`. Esa documentación se entrega
> fuera del alcance de esta spec; aquí el estado se verifica por el campo booleano tipado del
> criterio 4.

### Requerimiento 4: Utilidades de dinero en aritmética entera

**User Story:** Como desarrollador, quiero toda la aritmética de dinero centralizada en
enteros, para que ningún consumidor introduzca punto flotante ni un redondeo paralelo.

#### Acceptance Criteria

1. EL Utilidades_Dinero DEBERÁ exportar `MICRO` como constante entera de valor `1_000_000`.
2. EL Utilidades_Dinero DEBERÁ exportar `toMicros`, que para una entrada `c` de centavos
   entera en el rango `0` a `9_000_000_000` devuelve el entero `c × MICRO`, sin ninguna
   operación en punto flotante.
3. EL Utilidades_Dinero DEBERÁ exportar `roundHalfUp`, que para una entrada `m` de
   micro-centavos entera devuelve el entero de centavos más cercano a `m / MICRO`,
   resolviendo el empate hacia el entero superior.
4. CUANDO `roundHalfUp` recibe un valor cuya fracción de centavo es exactamente `0.5`, EL
   Utilidades_Dinero DEBERÁ devolver el entero superior, de modo que `5845500000` devuelve
   `5846` y `18835500000` devuelve `18836`.
5. EL Utilidades_Dinero DEBERÁ exportar `formatCents`, que para una entrada entera de centavos
   devuelve una cadena con el símbolo `$`, la parte entera agrupada de a tres dígitos con `,`
   y exactamente dos decimales, de modo que `129900` devuelve `$1,299.00`, `0` devuelve
   `$0.00`, `1990` devuelve `$19.90` y `100000000` devuelve `$1,000,000.00`.
6. EL Utilidades_Dinero DEBERÁ exportar una función de reparto por mayor resto que, dada una
   lista de montos enteros en micro-centavos y un total objetivo entero en centavos, devuelve
   una lista de la misma longitud y en el mismo orden, con un monto entero en centavos por
   posición, cuya suma iguala exactamente el total objetivo, sin mutar la lista de entrada.
7. CUANDO la función de reparto asigna los centavos sobrantes, EL Utilidades_Dinero DEBERÁ
   partir del piso `Math.floor(m / MICRO)` de cada posición y asignar un centavo por vez a
   las posiciones de mayor resto `m mod MICRO`, en orden descendente de resto, hasta agotar
   la diferencia entre el total objetivo y la suma de los pisos.
8. SI dos posiciones presentan el mismo resto fraccionario, ENTONCES EL Utilidades_Dinero
   DEBERÁ asignar el centavo sobrante a la posición de menor índice, de modo que el reparto
   sea determinista.
9. EL Utilidades_Dinero DEBERÁ devolver todo monto de dinero como entero, verificable con
   `Number.isInteger`, y DEBERÁ aplicar cada tasa como `× bps / 10000` con `bps` entero, sin
   literales de punto flotante ni `toFixed` sobre montos calculados.
10. CUANDO la función de reparto recibe una lista vacía y un total objetivo `0`, EL
    Utilidades_Dinero DEBERÁ devolver una lista vacía sin lanzar excepción.
11. EL Utilidades_Dinero DEBERÁ tratar `MICRO`, `toMicros`, `roundHalfUp`, `formatCents` y la
    función de reparto como funciones puras sin validación de entrada, asumiendo que el total
    objetivo recibido por el reparto es consistente con la lista de micro-centavos recibida,
    es decir el resultado de `roundHalfUp` sobre su suma; la validación del carrito reside en
    el Motor_Descuentos según el Requerimiento 9.

### Requerimiento 5: Estrategias de descuento con montos exactos

**User Story:** Como desarrollador, quiero cada regla de descuento como una estrategia
intercambiable que devuelve montos exactos, para poder añadir reglas sin tocar el motor y
para que el redondeo viva en un solo lugar.

#### Acceptance Criteria

1. EL Paquete_Shared DEBERÁ declarar la interfaz `DiscountStrategy` con
   `readonly name: DiscountName`, `readonly order: number`,
   `isApplicable(ctx: DiscountContext): boolean` y `apply(ctx: DiscountContext): DiscountResult`.
2. CADA Estrategia_Descuento DEBERÁ devolver `discountMicros` como el entero resultante de
   `baseAmountMicros × rateBps / 10000`, sin invocar `Math.round`, `Math.floor`,
   `Math.trunc` ni operaciones de punto flotante, sin convertir a centavos —conversión que
   queda exclusivamente en el Ensamblador_Totales— y permaneciendo dentro de
   `Number.MAX_SAFE_INTEGER` para subtotales originales de hasta `9_000_000_000` centavos.
3. EL `CategoryDiscount` DEBERÁ tener `name` igual a `'CATEGORY'`, `order` igual a `1` y
   `rateBps` igual a `1000`.
4. EL `CategoryDiscount` DEBERÁ calcular `baseAmountMicros` como `toMicros` de la suma de
   `priceCents × quantity` de las líneas cuyo producto resuelto en el contexto tiene
   `category` estrictamente igual al literal `'Tecnologia'`, sin comparar nunca contra la
   etiqueta `'Tecnología'` de `CATEGORY_LABEL`.
5. SI ninguna línea del carrito resuelve a un producto de categoría `'Tecnologia'`, ENTONCES
   EL `CategoryDiscount` DEBERÁ devolver `false` en `isApplicable` y, si `apply` se invoca de
   todas formas, DEBERÁ devolver `applied` en `false` con `baseAmountMicros` y
   `discountMicros` en `0`, sin lanzar excepción.
6. EL `VolumeDiscount` DEBERÁ tener `name` igual a `'VOLUME'`, `order` igual a `2` y
   `rateBps` igual a `500`.
7. CUANDO el subtotal remanente tras el `CategoryDiscount`, comparado en micro-centavos sin
   redondearlo previamente a centavos, es estrictamente mayor a `toMicros(10000)`, EL
   `VolumeDiscount` DEBERÁ devolver `true` en `isApplicable`.
8. SI el subtotal remanente tras el `CategoryDiscount`, comparado en micro-centavos, es igual
   o menor a `toMicros(10000)` —incluidos el caso frontera de exactamente `toMicros(10000)` y
   el caso de remanente `0`—, ENTONCES EL `VolumeDiscount` DEBERÁ devolver `false` en
   `isApplicable` y, si `apply` se invoca, DEBERÁ devolver `applied` en `false` con
   `discountMicros` en `0`, sin lanzar excepción.
9. EL `VolumeDiscount` DEBERÁ calcular `baseAmountMicros` como el subtotal remanente completo
   en micro-centavos tras el `CategoryDiscount`, es decir `originalSubtotalMicros` menos el
   `discountMicros` de la línea `CATEGORY`, abarcando las líneas de todas las categorías y no
   solo las de `'Tecnologia'`.
10. EL `CouponDiscount` DEBERÁ tener `name` igual a `'COUPON'`, `order` igual a `3` y
    `rateBps` igual a los bps enteros del cupón resuelto, en el rango `0` a `10000`, y
    `rateBps` igual a `0` cuando no hay cupón resuelto.
11. CUANDO el código de cupón coincide exactamente con un cupón registrado y activo, EL
    `CouponDiscount` DEBERÁ calcular `baseAmountMicros` como el subtotal remanente en
    micro-centavos tras el `VolumeDiscount` y `discountMicros` como
    `baseAmountMicros × rateBps / 10000`, sin redondeo intermedio.
12. SI el código de cupón no coincide exactamente con ningún cupón registrado o el cupón
    resuelto está expirado, ENTONCES EL `CouponDiscount` DEBERÁ devolver `false` en
    `isApplicable` con `discountMicros` en `0`, sin lanzar excepción y conservando intactos
    los `discountMicros` aportados por `CATEGORY` y `VOLUME`.
13. DONDE una Estrategia_Descuento se reporta como no aplicable, EL Ensamblador_Totales
    DEBERÁ emitir su `DiscountLine` conservando su `name` y un `label` no vacío, con
    `applied` en `false` y con `rateBps`, `baseAmountMicros`, `baseAmountCents`,
    `discountMicros` y `discountCents` en `0`.
14. EL Paquete_Shared DEBERÁ declarar `DiscountContext` con las líneas del carrito ya
    resueltas contra el catálogo —cada una con `productId`, `category`, `priceCents` entero no
    negativo y `quantity` entero mayor a `0`—, `originalSubtotalMicros`,
    `remainingSubtotalMicros` y el cupón resuelto opcional, expresando todo monto en
    micro-centavos enteros y toda tasa en bps enteros.
15. EL Paquete_Shared DEBERÁ declarar `DiscountResult` con `name: DiscountName`,
    `applied: boolean`, `rateBps` entero en el rango `0` a `10000`, y `baseAmountMicros` y
    `discountMicros` como enteros mayores o iguales a `0`, sin ningún campo expresado en
    centavos.
16. CUANDO una Estrategia_Descuento ejecuta `isApplicable` o `apply`, LA Estrategia_Descuento
    DEBERÁ dejar el `DiscountContext` recibido sin modificar y DEBERÁ devolver valores
    idénticos ante invocaciones repetidas con el mismo contexto.

### Requerimiento 6: Factory de estrategias y motor por inyección

**User Story:** Como desarrollador, quiero que el motor reciba sus estrategias por
constructor y que una factory las arme en producción, para poder probar el invariante del
tope y para añadir reglas sin modificar el motor.

#### Acceptance Criteria

1. EL Factory_Estrategias DEBERÁ devolver una lista de tipo `readonly DiscountStrategy[]` con
   exactamente las tres estrategias de producción ordenadas de forma ascendente por su campo
   entero `order`: `CategoryDiscount` con `order` 1, `VolumeDiscount` con `order` 2 y
   `CouponDiscount` con `order` 3, incluyendo las tres con independencia de si resultan
   aplicables al contexto recibido.
2. EL Motor_Descuentos DEBERÁ exponer un constructor que reciba la lista de estrategias como
   parámetro de tipo `readonly DiscountStrategy[]`, sin construir, descubrir ni completar
   estrategias internamente, y DEBERÁ dejar la lista recibida sin mutar tras cada cálculo.
3. CUANDO un test construye el Motor_Descuentos con una lista arbitraria de estrategias, EL
   Motor_Descuentos DEBERÁ recorrerla siguiendo el orden de índice de la lista recibida, sin
   reordenarla por `order` ni omitir elementos, consultando `isApplicable` una vez e
   invocando `apply` una sola vez por cada estrategia aplicable.
4. EL Motor_Descuentos DEBERÁ emitir exactamente una `DiscountLine` por cada estrategia
   recibida en el constructor, en el orden de índice de la lista recibida, de modo que cuando
   el Factory_Estrategias incorpora una estrategia adicional el Motor_Descuentos la incluye
   en la cascada y emite su línea sin que se modifique el código del Motor_Descuentos, con
   `applied` en `false`, `discountMicros` en `0` y `discountCents` en `0` cuando
   `isApplicable` devuelve `false`.
5. EL Paquete_Shared DEBERÁ exportar desde su punto de entrada público el Factory_Estrategias,
   el Motor_Descuentos y la interfaz `DiscountStrategy`, sin depender de NestJS, de Prisma ni
   de ningún módulo de transporte HTTP.
6. SI la lista de estrategias recibida por el constructor está vacía, ENTONCES EL
   Motor_Descuentos DEBERÁ devolver `rawDiscountMicros` en `0`, `rawDiscountCents` en `0`,
   `totalSavingsCents` en `0`, `capApplied` en `false`, `lines` vacío y `finalTotalCents`
   igual a `originalSubtotalCents`, sin lanzar excepción.
7. CUANDO el Motor_Descuentos se construye con estrategias stub cuya cascada produce un
   descuento crudo superior a `3500` puntos básicos del subtotal original, EL Motor_Descuentos
   DEBERÁ limitar `totalSavingsCents` a `capCents` y DEBERÁ reportar `capApplied` en `true`,
   con independencia del número y de las tasas de las estrategias inyectadas.
8. MIENTRAS EL Motor_Descuentos recorre la lista de estrategias, DEBERÁ entregar a cada
   estrategia un contexto cuyo monto base sea el valor exacto en micro-centavos dejado por la
   estrategia anterior, sin redondear ni truncar en ningún paso intermedio.

### Requerimiento 7: Cascada multiplicativa exacta sin redondeo intermedio

**User Story:** Como responsable del cálculo, quiero que la cascada corra en micro-centavos
exactos, para que el resultado no dependa del orden de los redondeos ni difiera entre capas.

#### Acceptance Criteria

1. EL Motor_Descuentos DEBERÁ ejecutar las estrategias en el orden de precedencia `CATEGORY`
   (orden 1), `VOLUME` (orden 2) y `COUPON` (orden 3), aplicando cada estrategia sobre el
   subtotal remanente en micro-centavos que dejó la estrategia anterior y nunca sobre el
   subtotal original; una estrategia no aplicable DEBERÁ dejar el subtotal remanente sin
   modificar y reportar su línea con `applied: false`, `discountMicros` igual a `0` y
   `discountCents` igual a `0`.
2. EL Motor_Descuentos DEBERÁ operar la cascada completa en micro-centavos enteros con escala
   `MICRO = 1_000_000`, convirtiendo cada entrada como `centavos × MICRO`, y DEBERÁ aplicar
   cada tasa como `× bps / 10000` con `bps` entero perteneciente al conjunto
   `{1000, 500, 1500}` y tope `3500`, sin usar aritmética de punto flotante en ningún paso.
3. EL Motor_Descuentos DEBERÁ conservar el resultado de cada paso de la cascada como entero
   exacto de micro-centavos, sin aplicar redondeo, truncamiento ni piso en ninguna estrategia
   ni en ningún paso intermedio; el único punto autorizado a redondear DEBERÁ ser el
   Ensamblador_Totales.
4. EL Motor_Descuentos DEBERÁ producir `rawDiscountMicros` como la suma exacta de los
   `discountMicros` de todas las estrategias aplicadas, y DEBERÁ producir
   `rawDiscountMicros` igual a `0`, `rawDiscountCents` igual a `0` y `capApplied` igual a
   `false`, sin lanzar excepción, cuando el carrito esté vacío o ninguna estrategia sea
   aplicable.
5. CUANDO se calcula un carrito de 1 × `PROD-001` sin cupón, con `originalSubtotalCents` igual
   a `129900`, EL Motor_Descuentos DEBERÁ producir `rawDiscountMicros` igual a `18835500000` y
   `rawDiscountCents` igual a `18836`, resultado de un único redondeo half-up final.
6. CUANDO se calcula un carrito de 1 × `PROD-001` con el cupón `WELCOME2026`, con
   `originalSubtotalCents` igual a `129900`, EL Motor_Descuentos DEBERÁ producir
   `rawDiscountMicros` igual a `35495175000` y `rawDiscountCents` igual a `35495`, valor que
   una política de redondeo por paso produciría como `35496` y que por tanto DEBERÁ fallar si
   el redondeo intermedio reaparece.
7. CUANDO se calcula un carrito de 1 × `PROD-001` con el cupón `WELCOME2026`, EL
   Motor_Descuentos DEBERÁ producir `effectiveDiscountBps` igual a `2732`, calculado como
   `round(totalSavingsCents × 10000 / originalSubtotalCents)`, valor estrictamente menor que
   la suma aritmética de las tasas (`1000 + 500 + 1500 = 3000` bps), evidenciando que la
   cascada es multiplicativa.
8. CUANDO la cascada termina, EL Motor_Descuentos DEBERÁ ejecutar un único redondeo half-up de
   `rawDiscountMicros` a `rawDiscountCents`, y DEBERÁ derivar los `discountCents` de cada
   línea tomando el piso de sus micro-centavos y repartiendo la diferencia contra
   `rawDiscountCents` de a un centavo por línea, empezando por la de mayor resto fraccionario,
   de modo que la suma de los `discountCents` de las líneas sea exactamente igual a
   `rawDiscountCents`.
9. SI el carrito contiene una cantidad menor o igual a `0`, una cantidad no entera, un
   `priceCents` que no sea entero mayor o igual a `0`, o un identificador de producto ausente
   del catálogo, ENTONCES EL Motor_Descuentos DEBERÁ rechazar el cálculo con un error tipado,
   sin ejecutar ninguna estrategia y sin devolver totales parciales.

### Requerimiento 8: Único redondeo, tope con floor y totales derivados

**User Story:** Como responsable del cálculo, quiero un solo punto de redondeo y un tope
aplicado con floor, para que el ahorro reportado nunca supere el 35% y para que el total
final no pueda desincronizarse del desglose.

#### Acceptance Criteria

1. EL Ensamblador_Totales DEBERÁ calcular `rawDiscountCents` como
   `roundHalfUp(rawDiscountMicros)`, donde `roundHalfUp(micros) = Math.round(micros / MICRO)`
   y `MICRO = 1_000_000`, y esta DEBERÁ ser la única operación de redondeo o truncamiento
   sobre montos de la cascada en todo el Paquete_Shared: las estrategias de descuento DEBERÁN
   devolver `discountMicros` exactos, sin `Math.round`, `Math.floor`, `Math.ceil` ni
   `toFixed`.
2. EL Ensamblador_Totales DEBERÁ calcular `capCents` como
   `Math.floor(originalSubtotalCents × 3500 / 10000)`, usando siempre floor y nunca ceil ni
   redondeo half-up, y el resultado DEBERÁ ser un entero mayor o igual a `0`.
3. EL Ensamblador_Totales DEBERÁ calcular `totalSavingsCents` como
   `Math.min(rawDiscountCents, capCents)`, de modo que el valor emitido quede siempre en el
   rango entero `0` a `capCents` inclusive.
4. SI `rawDiscountCents` es estrictamente mayor que `capCents`, ENTONCES EL
   Ensamblador_Totales DEBERÁ fijar `capApplied` en `true`.
5. SI `rawDiscountCents` es menor o igual que `capCents`, incluido el caso de igualdad exacta
   que corresponde a un descuento de exactamente el 35%, ENTONCES EL Ensamblador_Totales
   DEBERÁ fijar `capApplied` en `false`.
6. EL Ensamblador_Totales DEBERÁ derivar `finalTotalCents` como
   `originalSubtotalCents − totalSavingsCents`, sin calcularlo por ninguna otra vía,
   cumpliendo el invariante
   `finalTotalCents + totalSavingsCents === originalSubtotalCents` para toda entrada válida.
7. EL Ensamblador_Totales DEBERÁ calcular `effectiveDiscountBps` como
   `Math.round(totalSavingsCents × 10000 / originalSubtotalCents)`, emitiendo un entero en el
   rango `0` a `3500` inclusive.
8. SI `originalSubtotalCents` es igual a `0`, ENTONCES EL Ensamblador_Totales DEBERÁ fijar
   `effectiveDiscountBps` en `0` sin ejecutar la división y sin lanzar excepción.
9. DONDE el Motor_Descuentos se construye con el Factory_Estrategias, EL Ensamblador_Totales
   DEBERÁ emitir `lines` con exactamente tres elementos, siempre presentes y en el orden de
   precedencia `CATEGORY`, `VOLUME`, `COUPON`; y para cada regla no aplicable DEBERÁ emitir
   `applied: false` con `baseAmountMicros`, `baseAmountCents`, `discountMicros` y
   `discountCents` en `0`.
10. EL Ensamblador_Totales DEBERÁ calcular el `discountCents` de cada línea como
    `Math.floor(discountMicros / MICRO)` y DEBERÁ repartir la diferencia entre
    `rawDiscountCents` y la suma de esos pisos de a un centavo, en orden descendente de resto
    fraccionario y, ante restos iguales, en el orden de precedencia `CATEGORY`, `VOLUME`,
    `COUPON`, de modo que la suma de los `discountCents` iguale exactamente
    `rawDiscountCents`.
11. MIENTRAS `capApplied` es `true`, EL Ensamblador_Totales DEBERÁ mantener la suma de los
    `discountCents` de las líneas igual a `rawDiscountCents`, quedando la diferencia
    `rawDiscountCents − totalSavingsCents` como el monto truncado, un entero estrictamente
    mayor que `0`.
12. CUANDO se calcula el carrito de 1 × `PROD-001` con el cupón `WELCOME2026`, EL
    Ensamblador_Totales DEBERÁ producir `originalSubtotalCents` `129900`,
    `rawDiscountMicros` `35495175000`, `discountCents` de línea `12990`, `5845` y `16660`,
    `rawDiscountCents` `35495` y no `35496`, `capCents` `45465`, `capApplied` `false`,
    `totalSavingsCents` `35495`, `effectiveDiscountBps` `2732` y `finalTotalCents` `94405`.
13. CUANDO se calcula un carrito sin líneas o cuyo `originalSubtotalCents` es `0`, EL
    Ensamblador_Totales DEBERÁ emitir `rawDiscountMicros`, `rawDiscountCents`, `capCents`,
    `totalSavingsCents`, `effectiveDiscountBps` y `finalTotalCents` en `0`, `capApplied` en
    `false` y las líneas correspondientes a las estrategias recibidas con `applied: false`,
    sin lanzar excepción.
14. EL Ensamblador_Totales DEBERÁ emitir todos los campos `*Cents`, `*Micros` y `*Bps` de
    `CheckoutTotals` y de cada `DiscountLine` como enteros no negativos, verificables con
    `Number.isInteger` y sin representación en punto flotante.

### Requerimiento 9: Carritos inválidos y errores tipados

**User Story:** Como consumidor del motor, quiero que un carrito corrupto falle con un error
tipado y que un carrito vacío devuelva cero sin excepción, para distinguir el dato inválido
del caso legítimo sin descuento.

#### Acceptance Criteria

1. CUANDO el carrito recibido contiene exactamente `0` líneas, EL Motor_Descuentos DEBERÁ
   devolver, sin lanzar excepción, un `CheckoutTotals` con `originalSubtotalCents` `0`,
   `rawDiscountMicros` `0`, `rawDiscountCents` `0`, `capCents` `0`, `capApplied` `false`,
   `totalSavingsCents` `0`, `effectiveDiscountBps` `0`, `finalTotalCents` `0` y, DONDE el
   motor se construyó con el Factory_Estrategias, exactamente `3` líneas en el orden de
   precedencia `CATEGORY`, `VOLUME`, `COUPON`, cada una con `applied` en `false`,
   `baseAmountMicros` `0`, `baseAmountCents` `0`, `discountMicros` `0` y `discountCents` `0`.
2. SI una línea del carrito declara `quantity` menor o igual a `0`, ENTONCES EL
   Motor_Descuentos DEBERÁ lanzar un error tipado con `code` igual a `'INVALID_CART'` y con
   `details` que identifique el índice de la línea y su `productId`, sin devolver totales.
3. SI una línea del carrito declara `quantity` que no es un entero finito, incluidos valores
   fraccionarios, `NaN` e `Infinity`, ENTONCES EL Motor_Descuentos DEBERÁ lanzar un error
   tipado con `code` igual a `'INVALID_CART'` y con `details` que identifique el índice de la
   línea y el valor rechazado, sin devolver totales.
4. SI un producto del contexto declara `priceCents` que no es un entero finito mayor o igual a
   `0`, incluidos valores negativos, fraccionarios, `NaN` e `Infinity`, ENTONCES EL
   Motor_Descuentos DEBERÁ lanzar un error tipado con `code` igual a `'INVALID_CART'` y con
   `details` que identifique el `productId` y el valor rechazado, sin devolver totales.
5. SI una línea del carrito referencia un `productId` ausente del catálogo provisto en el
   contexto, comparado por igualdad exacta de cadena, ENTONCES EL Motor_Descuentos DEBERÁ
   lanzar un error tipado con `code` igual a `'PRODUCT_NOT_FOUND'` y con `details` que incluya
   el `productId` no resuelto, sin devolver totales.
6. EL error tipado del Motor_Descuentos DEBERÁ exponer un `code` de tipo `ErrorCode`, un
   `message` no vacío y un `details` opcional de tipo `Record<string, unknown>`, sin importar
   NestJS, sin exponer códigos de estado HTTP y sin depender de Prisma.
7. SI el código de cupón está ausente, es una cadena vacía, no está registrado o está
   expirado, ENTONCES EL Motor_Descuentos DEBERÁ completar la cascada con las reglas
   restantes y reportar la línea `COUPON` con `applied` en `false`, `discountMicros` `0` y
   `discountCents` `0`, sin lanzar excepción.
8. CUANDO EL Motor_Descuentos valida el carrito, DEBERÁ recorrer las líneas en orden ascendente
   de índice y, dentro de cada línea, resolver primero el `productId`
   (`'PRODUCT_NOT_FOUND'`) y validar después `quantity` y `priceCents` (`'INVALID_CART'`),
   lanzando únicamente el primer error detectado y deteniendo el cálculo.
9. SI la suma de `priceCents × quantity` de todas las líneas excede `9_000_000_000` centavos,
   cota de exactitud de la escala de micro-centavos frente a `Number.MAX_SAFE_INTEGER`,
   ENTONCES EL Motor_Descuentos DEBERÁ lanzar un error tipado con `code` igual a
   `'INVALID_CART'`, sin devolver totales.
10. SI EL Motor_Descuentos lanza un error tipado, ENTONCES DEBERÁ dejar el contexto de entrada,
    incluidos el carrito, el catálogo y el cupón, sin modificaciones, y no DEBERÁ devolver un
    `CheckoutTotals` parcial.

### Requerimiento 10: Pureza y tipado estricto del paquete

**User Story:** Como desarrollador, quiero `packages/shared` libre de dependencias de
framework y con tipado estricto sin escapes, para poder testear el motor en aislamiento y
consumirlo desde ambos lados.

#### Acceptance Criteria

1. EL Paquete_Shared DEBERÁ declarar cero dependencias de runtime, admitiendo únicamente
   devDependencies de herramientas de compilación y prueba, y DEBERÁ mantener cero sentencias
   `import` y cero llamadas `require` hacia NestJS, Prisma, clientes HTTP o cualquier API de
   red o de sistema de archivos, tanto en su código de producción como en el de pruebas.
2. CUANDO el Compilador_TypeScript verifica el Paquete_Shared con `tsc --noEmit`, EL
   Paquete_Shared DEBERÁ terminar con cero errores de tipo, y el comando DEBERÁ devolver
   código de salida distinto de cero ante el primer error.
3. EL Paquete_Shared DEBERÁ derivar cada conjunto cerrado de valores (`ProductCategory`,
   `DiscountName`, `ErrorCode`) desde un único arreglo literal declarado con `as const`, con
   cero uniones de literales escritas a mano que dupliquen esos valores.
4. EL Paquete_Shared DEBERÁ mantener cero ocurrencias de `any`, cero type assertions distintas
   de `as const`, cero `@ts-ignore` y cero `@ts-expect-error` en su código de producción y de
   pruebas, incluidos los dobles de prueba.
5. EL Paquete_Shared DEBERÁ comparar la categoría contra el literal `'Tecnologia'` (sin tilde)
   y reservar la cadena `'Tecnología'` (con tilde) exclusivamente como valor de
   `CATEGORY_LABEL`, con cero comparaciones contra la etiqueta.
6. EL Paquete_Shared DEBERÁ habilitar `strict: true`, `noImplicitAny: true` y
   `strictNullChecks: true` heredados de `tsconfig.base.json`.
7. SI aparece en el Paquete_Shared una importación de NestJS, Prisma o un cliente HTTP, o un
   `any`, un `@ts-ignore` o un `@ts-expect-error`, ENTONCES el script de verificación
   ejecutable del propio workspace —lint o script equivalente declarado en
   `packages/shared`— DEBERÁ terminar con código de salida distinto de cero e identificar el
   archivo, la línea y el elemento prohibido.
8. CUANDO se ejecuta la suite de pruebas del Paquete_Shared, EL Paquete_Shared DEBERÁ
   completarla sin arrancar la API, sin abrir conexiones a base de datos y sin realizar
   peticiones de red, y DEBERÁ producir resultados idénticos en ejecuciones repetidas con las
   mismas entradas.

### Requerimiento 11: Invariantes verificables del motor

**User Story:** Como responsable de la corrección del cálculo, quiero invariantes afirmados
como propiedades, para detectar regresiones que un caso puntual dejaría pasar.

#### Acceptance Criteria

1. CUANDO el Motor_Descuentos calcula un `CheckoutTotals` para un carrito válido generado
   (según el criterio 7), EL Motor_Descuentos DEBERÁ satisfacer
   `finalTotalCents + totalSavingsCents === originalSubtotalCents` en el 100% de los casos
   generados, con `finalTotalCents` derivado de esa resta y no de un cálculo independiente.
2. CUANDO el Motor_Descuentos calcula un `CheckoutTotals` para un carrito válido generado con
   las estrategias del Factory_Estrategias, EL Motor_Descuentos DEBERÁ devolver exactamente 3
   líneas, en el orden `CATEGORY`, `VOLUME`, `COUPON`, cuya suma de `discountCents` iguale
   `rawDiscountCents` incluso cuando `capApplied === true`, y DEBERÁ reportar
   `applied === false`, `discountMicros === 0` y `discountCents === 0` en toda línea no
   aplicable.
3. CUANDO el Motor_Descuentos calcula un `CheckoutTotals` para un carrito válido generado, EL
   Motor_Descuentos DEBERÁ satisfacer
   `0 <= totalSavingsCents <= capCents <= originalSubtotalCents`, con
   `capCents === floor(originalSubtotalCents × 3500 / 10000)` y `effectiveDiscountBps` entre
   `0` y `3500` inclusive; y para el carrito generado de `0` líneas DEBERÁ devolver
   `originalSubtotalCents === 0`, `rawDiscountMicros === 0`, `rawDiscountCents === 0`,
   `totalSavingsCents === 0`, `effectiveDiscountBps === 0`, `capApplied === false` y
   `finalTotalCents === 0` sin lanzar excepción.
4. CUANDO el Motor_Descuentos calcula un `CheckoutTotals` para un carrito válido generado, EL
   Motor_Descuentos DEBERÁ satisfacer `capApplied === (rawDiscountCents > capCents)` con
   comparación estrictamente mayor, de modo que `rawDiscountCents === capCents` produzca
   `capApplied === false`; y para todos los casos generados que usen solo el catálogo del seed
   y los cupones `WELCOME2026` o `SUMMER2024` DEBERÁ observarse `capApplied === false`.
5. CUANDO el Motor_Descuentos recibe dos veces consecutivas el mismo contexto, EL
   Motor_Descuentos DEBERÁ producir dos `CheckoutTotals` idénticos campo por campo en
   comparación estructural profunda, DEBERÁ dejar el contexto de entrada sin mutar y no DEBERÁ
   depender del reloj, de aleatoriedad, de la red ni de la base de datos.
6. CUANDO el Motor_Descuentos calcula un `CheckoutTotals` para un carrito válido generado, EL
   Motor_Descuentos DEBERÁ producir todos los campos `*Cents` y `*Micros`, tanto de los
   totales como de cada línea, como enteros finitos y mayores o iguales a `0`, sin `NaN`, sin
   `Infinity` y sin valores fraccionarios.
7. CUANDO se ejecuta la verificación de los criterios 1 a 6, LA Suite_Invariantes DEBERÁ
   generar, con semilla fija registrada en el repositorio y un mínimo de 1000 casos por
   propiedad, carritos de `0` a `6` líneas con `productId` del catálogo del seed sin repetirse
   entre líneas, cantidad entera entre `1` y el stock del producto, y cupón tomado del
   conjunto {sin cupón, `WELCOME2026`, `SUMMER2024`, `DEMOCAP50`, un código no registrado}; y
   DEBERÁ fallar el comando de test reportando el caso mínimo reducido cuando cualquier caso
   generado incumpla una propiedad. El generador de propiedades se declara como devDependency
   de `packages/shared`, de modo que no cuenta como dependencia de runtime a efectos del
   Requerimiento 10 criterio 1.
8. SI el contexto generado contiene datos corruptos, entendidos como cantidad menor o igual a
   `0`, cantidad no entera, `priceCents` que no es entero mayor o igual a `0`, o `productId`
   ausente del catálogo, ENTONCES EL Motor_Descuentos DEBERÁ rechazar el cálculo con un error
   tipado que indique la causa y la línea afectada, sin devolver un `CheckoutTotals` parcial y
   sin mutar el contexto de entrada.
9. CUANDO el Motor_Descuentos calcula un `CheckoutTotals` para un carrito válido generado, EL
   Motor_Descuentos DEBERÁ satisfacer `rawDiscountCents === roundHalfUp(rawDiscountMicros)`
   como único redondeo de todo el cálculo, y por cada línea la diferencia
   `discountCents - floor(discountMicros / MICRO)` DEBERÁ valer `0` o `1`, valiendo `1`
   únicamente en las líneas de mayor resto fraccionario hasta cubrir la diferencia contra
   `rawDiscountCents`.

### Requerimiento 12: Suite de pruebas y umbral de cobertura propio

**User Story:** Como responsable de calidad, quiero que `packages/shared` tenga su propio
runner y su propio umbral de cobertura, para que el motor —la pieza más importante— quede
medido de verdad y el comando falle cuando no se cumple.

#### Acceptance Criteria

1. CUANDO se invoca `npm run test:cov --workspace packages/shared`, EL Paquete_Shared DEBERÁ
   ejecutar la totalidad de sus archivos de prueba con Vitest en modo de ejecución única, sin
   modo watch y sin requerir interacción del usuario, y emitir un reporte con los porcentajes
   de cobertura de líneas y de ramas.
2. EL Suite_Pruebas_Shared DEBERÁ declarar en su propia configuración de Vitest un
   `coverageThreshold` de `80` por ciento en líneas y de `80` por ciento en ramas, medido
   sobre los módulos fuente del motor de descuentos, sus estrategias, la factory y las
   utilidades de redondeo y formateo de dinero, excluyendo del cálculo los propios archivos de
   prueba y los archivos que solo contienen declaraciones de tipos.
3. SI la cobertura de líneas o la cobertura de ramas resulta estrictamente menor a `80` por
   ciento, ENTONCES EL Suite_Pruebas_Shared DEBERÁ terminar con un código de salida distinto
   de cero e indicar en la salida qué métrica quedó por debajo y con qué porcentaje medido;
   una cobertura de exactamente `80` por ciento en ambas métricas DEBERÁ considerarse
   aprobada.
4. EL Suite_Pruebas_Shared DEBERÁ ejecutarse sin iniciar el servidor HTTP de la API, sin abrir
   conexión a base de datos y sin realizar peticiones de red, y DEBERÁ producir el mismo
   conjunto de resultados y los mismos montos esperados en ejecuciones repetidas sobre el
   mismo código.
5. EL Suite_Pruebas_Shared DEBERÁ declarar sus dobles de prueba con tipos explícitos, sin
   `any`, sin aserciones que ensanchen el tipo (`as any`, `as unknown as T`) y sin
   `@ts-ignore` ni `@ts-expect-error`, y DEBERÁ compilar con `strict: true`.
6. SI al menos una prueba de la suite falla o si la ejecución termina por un error no
   controlado, ENTONCES EL Suite_Pruebas_Shared DEBERÁ terminar con un código de salida
   distinto de cero, con independencia de que los porcentajes de cobertura alcancen el umbral.
7. SI la ejecución no descubre ningún archivo de prueba o no logra generar el reporte de
   cobertura, ENTONCES EL Suite_Pruebas_Shared DEBERÁ terminar con un código de salida
   distinto de cero e indicar la ausencia de pruebas o de reporte, en lugar de reportar la
   ejecución como aprobada.
8. EL Suite_Pruebas_Shared DEBERÁ evaluar su umbral a partir de su propia configuración dentro
   de `packages/shared`, sin depender de la configuración de cobertura de `apps/backend` ni de
   `apps/frontend`, de modo que la cobertura del motor se mida aunque los umbrales de los
   otros workspaces cambien o se eliminen.

### Requerimiento 13: Casos borde obligatorios cubiertos

**User Story:** Como responsable de calidad, quiero los casos borde del motor cubiertos de
forma explícita y determinista, para que el desglose sea auditable y las regresiones de
redondeo fallen de inmediato.

#### Acceptance Criteria

1. EL Suite_Pruebas_Shared DEBERÁ cubrir un caso donde `rawDiscountCents` supera estrictamente
   `capCents`, afirmando `capApplied === true`, `totalSavingsCents === capCents`,
   `capCents === Math.floor(originalSubtotalCents * 3500 / 10000)`,
   `finalTotalCents === originalSubtotalCents - totalSavingsCents` y
   `effectiveDiscountBps <= 3500`.
2. DONDE el caso del tope se produce por inyección, EL Suite_Pruebas_Shared DEBERÁ pasar la
   lista de estrategias stub al constructor del Motor_Descuentos, con las tasas expresadas en
   puntos básicos enteros y los dobles de prueba tipados contra la interfaz
   `DiscountStrategy` sin `any`, sin `as` de silenciamiento y sin `@ts-ignore`.
3. EL Suite_Pruebas_Shared DEBERÁ cubrir la frontera del tope con dos casos construidos por
   inyección de estrategias stub: uno con `rawDiscountCents === capCents - 1`, que afirma
   `capApplied === false` y `totalSavingsCents === rawDiscountCents`, y otro con
   `rawDiscountCents === capCents + 1`, que afirma `capApplied === true` y
   `totalSavingsCents === capCents`.
4. EL Suite_Pruebas_Shared DEBERÁ cubrir un caso con el cupón de demo `DEMOCAP50` sobre un
   carrito compuesto exclusivamente por productos del catálogo pre-configurado y con
   cantidades dentro del stock disponible, afirmando `capApplied === true` y
   `totalSavingsCents === capCents`.
5. EL Suite_Pruebas_Shared DEBERÁ cubrir un caso que recorra el catálogo pre-configurado en
   las cuatro variantes de cupón del enunciado —sin cupón, `WELCOME2026`, `SUMMER2024` y un
   código no registrado— excluyendo `DEMOCAP50`, y afirmar `capApplied === false` y
   `rawDiscountCents <= capCents` en todas ellas.
6. EL Suite_Pruebas_Shared DEBERÁ cubrir la frontera del volumen con dos casos: un subtotal
   tras la regla de categoría de exactamente `10000` centavos, que afirma que la línea
   `VOLUME` queda con `applied === false` y `discountMicros === 0`, y uno de `10001` centavos,
   que afirma `applied === true` y `discountMicros` igual al valor exacto de
   `baseAmountMicros * 500 / 10000`.
7. EL Suite_Pruebas_Shared DEBERÁ cubrir el carrito vacío sobre un Motor_Descuentos construido
   con el Factory_Estrategias, afirmando, sin que se lance excepción,
   `originalSubtotalCents === 0`, `rawDiscountMicros === 0`, `rawDiscountCents === 0`,
   `totalSavingsCents === 0`, `capApplied === false`, `finalTotalCents === 0` y las tres líneas
   presentes con `applied === false`.
8. SI el carrito contiene una cantidad negativa, un precio inválido o un identificador de
   producto ausente del catálogo, ENTONCES EL Suite_Pruebas_Shared DEBERÁ afirmar que el
   Motor_Descuentos lanza un error tipado con `code === 'INVALID_CART'` para los dos primeros
   casos y `code === 'PRODUCT_NOT_FOUND'` para el tercero, y que no se devuelve ningún
   `CheckoutTotals` parcial.
9. SI el cupón no está registrado o está expirado, ENTONCES EL Suite_Pruebas_Shared DEBERÁ
   afirmar que no se lanza excepción, que la línea `COUPON` queda con `applied === false`,
   `discountMicros === 0` y `discountCents === 0`, y que las líneas `CATEGORY` y `VOLUME`
   conservan los montos que tendrían sin cupón.
10. EL Suite_Pruebas_Shared DEBERÁ cubrir el cupón `WELCOME2026` afirmando que las líneas
    llegan en el orden `CATEGORY`, `VOLUME`, `COUPON`, que el `baseAmountMicros` de `COUPON` es
    igual al subtotal exacto en micro-centavos que dejó `VOLUME`, y que su `discountMicros` es
    igual a `baseAmountMicros * 1500 / 10000`.
11. EL Suite_Pruebas_Shared DEBERÁ cubrir los tres escenarios de cascada —solo categoría,
    categoría más volumen, y las tres reglas combinadas— afirmando en cada uno el `applied` y
    el `discountMicros` exacto de las tres líneas.
12. EL Suite_Pruebas_Shared DEBERÁ cubrir un carrito mixto afirmando que el `baseAmountMicros`
    de la línea `CATEGORY` es igual a la suma en micro-centavos de las líneas de categoría
    `Tecnologia` y estrictamente menor que `originalSubtotalCents` convertido a micro-centavos.
13. EL Suite_Pruebas_Shared DEBERÁ incluir un test dedicado al redondeo con el fixture
    1 × `PROD-001` más `WELCOME2026`, que afirma `totalSavingsCents === 35495`,
    `capApplied === false` y las `discountCents` por línea `12990`, `5845` y `16660`, de modo
    que una política de redondeo half-up por paso, que arrojaría `35496`, haga fallar el test.
14. EL Suite_Pruebas_Shared DEBERÁ incluir un test que afirme que la suma de las
    `discountCents` de las tres líneas es exactamente igual a `rawDiscountCents`, con al menos
    un caso donde el reparto por mayor resto asigna un centavo sobrante y al menos un caso con
    `capApplied === true` donde la diferencia entre esa suma y `totalSavingsCents` es
    exactamente el truncamiento del tope.
15. EL Suite_Pruebas_Shared DEBERÁ incluir un test que afirme, para cada una de las tres
    Estrategia_Descuento, que el `discountMicros` devuelto es igual al valor exacto de
    `baseAmountMicros * rateBps / 10000`, incluyendo al menos un caso cuyo valor exacto no es
    múltiplo de `MICRO`, de forma que cualquier redondeo dentro de una estrategia haga fallar
    el test.
16. EL Suite_Pruebas_Shared DEBERÁ cubrir, por inyección de estrategias stub, un caso con
    `rawDiscountCents === capCents`, afirmando `capApplied === false` y
    `totalSavingsCents === rawDiscountCents`, de modo que un descuento de exactamente el 35%
    no active el truncamiento.
17. EL Suite_Pruebas_Shared DEBERÁ incluir un test que afirme que la cascada es multiplicativa
    y no una suma de porcentajes, comparando el `totalSavingsCents` del caso de las tres reglas
    combinadas contra el valor que resultaría de sumar `1000`, `500` y `1500` bps sobre
    `originalSubtotalCents` y verificando que ambos difieren.
18. EL Suite_Pruebas_Shared DEBERÁ ejecutar cada uno de los casos borde anteriores de forma
    determinista y aislada, sin levantar la API ni la base de datos, con montos de entrada
    fijos en centavos enteros y sin valores aleatorios ni dependientes de la fecha del sistema.
