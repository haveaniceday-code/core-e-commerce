# Requirements Document

## Introduction

El motor de descuentos acumulativos: tres estrategias intercambiables, la factory que las arma,
el motor que las recorre por inyección, la cascada multiplicativa en aritmética exacta, el
ensamblador que hace el único redondeo del sistema y aplica el tope, la validación del carrito
con errores tipados, y la suite de pruebas con su umbral de cobertura.

Es la pieza que la prueba realmente evalúa: aquí vive la matemática del descuento y la política
de redondeo. Todo lo que se construya después consume este motor sin reimplementar el cálculo.

**Cadena de specs:** `monorepo-foundation` → `shared-contracts-seed` → `discount-engine`.
Referencias entre specs con prefijo (`MF-`, `SCS-`, `DE-`); dentro del documento, `R2.4` es
"Requerimiento 2, criterio 4". Criterios en EARS.

**Hereda y no repite.** De `monorepo-foundation`: cero dependencias de framework, cero `any` y
cero assertions salvo `as const` —también en los dobles de prueba—, y el arnés de Vitest. De
`shared-contracts-seed`: los contratos `DiscountLine`, `CheckoutTotals`, `ErrorCode` y `ApiError`;
el seed con `findProductById` y `findCouponByCode`; y `MICRO`, `toMicros`, `roundHalfUp`,
`applyBps` y `allocateByLargestRemainder`.

**Fuera de alcance:** `apps/backend`, `apps/frontend`, los endpoints, y el mapeo de `ErrorCode` a
códigos HTTP, que es de un filtro de excepciones del backend. `INSUFFICIENT_STOCK` no se emite
aquí: el motor no conoce el stock.

## Requirements

### Requerimiento 1: Estrategias de descuento con montos exactos

**User Story:** Como desarrollador, quiero cada regla como una estrategia intercambiable que
devuelve montos exactos, para añadir reglas sin tocar el motor y para que el redondeo viva en un
solo lugar.

#### Acceptance Criteria

1. EL Paquete_Shared DEBERÁ declarar `DiscountStrategy` con `readonly name: DiscountName`,
   `readonly order: number`, `isApplicable(ctx): boolean` y `apply(ctx): DiscountResult`.
2. CADA Estrategia DEBERÁ devolver `discountMicros` como el entero
   `baseAmountMicros × rateBps / 10000`, sin `Math.round`, `Math.floor` ni `Math.trunc`, y sin
   convertir a centavos —conversión exclusiva del Ensamblador.
3. EL `CategoryDiscount` DEBERÁ tener `name` `'CATEGORY'`, `order` `1` y `rateBps` `1000`.
4. EL `CategoryDiscount` DEBERÁ calcular `baseAmountMicros` como `toMicros` de la suma de
   `priceCents × quantity` de las líneas cuyo producto tiene `category` estrictamente igual al
   literal `'Tecnologia'`, sin comparar nunca contra la etiqueta `'Tecnología'`.
5. SI ninguna línea resuelve a categoría `'Tecnologia'`, ENTONCES EL `CategoryDiscount` DEBERÁ
   devolver `false` en `isApplicable` y, si `apply` se invoca igual, `applied: false` con
   `baseAmountMicros` y `discountMicros` en `0`, sin lanzar excepción.
6. EL `VolumeDiscount` DEBERÁ tener `name` `'VOLUME'`, `order` `2` y `rateBps` `500`, y DEBERÁ
   aplicar cuando el remanente tras `CATEGORY` sea **estrictamente mayor** a `toMicros(10000)`,
   comparado en micro-centavos sin redondear previamente a centavos; exactamente `toMicros(10000)`
   y el remanente `0` DEBERÁN dar `applied: false` con `discountMicros` en `0`.
7. EL `VolumeDiscount` DEBERÁ calcular `baseAmountMicros` como el remanente completo tras
   `CATEGORY` —`originalSubtotalMicros` menos el `discountMicros` de `CATEGORY`—, abarcando todas
   las categorías y no solo `'Tecnologia'`.
8. EL `CouponDiscount` DEBERÁ tener `name` `'COUPON'`, `order` `3` y `rateBps` igual a los bps del
   cupón resuelto, o `0` si no hay; y SI el código está ausente, vacío, no registrado o expirado,
   ENTONCES DEBERÁ devolver `false` en `isApplicable` con `discountMicros` en `0`, sin lanzar
   excepción y conservando intactos los montos de `CATEGORY` y `VOLUME`.
9. CUANDO el cupón resuelto está activo, EL `CouponDiscount` DEBERÁ calcular `baseAmountMicros`
   como el remanente tras `VOLUME` y `discountMicros` como `baseAmountMicros × rateBps / 10000`,
   sin redondeo intermedio.
10. EL Paquete_Shared DEBERÁ declarar `DiscountContext` —líneas ya resueltas con `productId`,
    `category`, `priceCents` y `quantity`, más `originalSubtotalMicros`,
    `remainingSubtotalMicros` y el cupón resuelto opcional— y `DiscountResult` —`name`,
    `applied`, `rateBps`, `baseAmountMicros`, `discountMicros`—, ambos con todos sus campos
    `readonly`, todo monto en micro-centavos enteros, **sin ningún campo en centavos**, de modo
    que una estrategia deje el contexto sin mutar y devuelva lo mismo ante invocaciones repetidas.

### Requerimiento 2: Factory de estrategias y motor por inyección

**User Story:** Como desarrollador, quiero que el motor reciba sus estrategias por constructor y
que una factory las arme en producción, para poder probar el invariante del tope y para añadir
reglas sin modificar el motor.

#### Acceptance Criteria

1. EL Factory DEBERÁ devolver `readonly DiscountStrategy[]` con exactamente las tres estrategias
   de producción ordenadas de forma ascendente por `order` (1, 2, 3), incluyendo las tres con
   independencia de si resultan aplicables.
2. EL Motor DEBERÁ exponer un constructor que reciba `readonly DiscountStrategy[]`, sin construir
   ni descubrir estrategias internamente, y DEBERÁ dejar la lista sin mutar tras cada cálculo.
3. CUANDO un test construye el Motor con una lista arbitraria, EL Motor DEBERÁ recorrerla en el
   **orden de índice de la lista recibida**, sin reordenar por `order` ni omitir elementos,
   consultando `isApplicable` una vez e invocando `apply` una vez por estrategia aplicable.
4. EL Motor DEBERÁ emitir exactamente una `DiscountLine` por estrategia recibida, en ese mismo
   orden, de modo que incorporar una cuarta regla al Factory la incluya en la cascada y emita su
   línea sin modificar el código del Motor.
5. SI la lista recibida está vacía, ENTONCES EL Motor DEBERÁ devolver `rawDiscountMicros`,
   `rawDiscountCents` y `totalSavingsCents` en `0`, `capApplied` en `false`, `lines` vacío y
   `finalTotalCents` igual a `originalSubtotalCents`, sin lanzar excepción.
6. EL Paquete_Shared DEBERÁ exportar el Factory, el Motor y la interfaz `DiscountStrategy` desde
   su punto de entrada público.

### Requerimiento 3: Cascada multiplicativa exacta

**User Story:** Como responsable del cálculo, quiero que la cascada corra en micro-centavos
exactos, para que el resultado no dependa del orden de los redondeos ni difiera entre capas.

#### Acceptance Criteria

1. EL Motor DEBERÁ ejecutar las estrategias en el orden de precedencia `CATEGORY`, `VOLUME`,
   `COUPON`, aplicando cada una sobre el remanente en micro-centavos que dejó la anterior y nunca
   sobre el subtotal original; una estrategia no aplicable DEBERÁ dejar el remanente sin
   modificar y reportar su línea con `applied: false` y montos en `0`.
2. EL Motor DEBERÁ operar la cascada completa en micro-centavos enteros con `MICRO = 1_000_000`,
   aplicando cada tasa como `× bps / 10000` con `bps` entero, **sin redondeo, truncamiento ni
   piso en ninguna estrategia ni en ningún paso intermedio**; el único punto autorizado a
   redondear DEBERÁ ser el Ensamblador.
3. EL Motor DEBERÁ producir `rawDiscountMicros` como la suma exacta de los `discountMicros` de
   las estrategias aplicadas, y `0` sin lanzar excepción cuando el carrito esté vacío o ninguna
   estrategia sea aplicable.
4. CUANDO se calcula 1 × `PROD-001` sin cupón (`originalSubtotalCents` `129900`), EL Motor DEBERÁ
   producir `rawDiscountMicros` `18835500000` y `rawDiscountCents` `18836`.
5. CUANDO se calcula 1 × `PROD-001` con `WELCOME2026`, EL Motor DEBERÁ producir
   `rawDiscountMicros` `35495175000` y `rawDiscountCents` **`35495`**, valor que una política de
   redondeo por paso produciría como `35496` y que por tanto DEBERÁ fallar si el redondeo
   intermedio reaparece.
6. CUANDO se calcula 1 × `PROD-001` con `WELCOME2026`, EL Motor DEBERÁ producir
   `effectiveDiscountBps` `2732`, estrictamente menor que la suma aritmética de las tasas
   (`1000 + 500 + 1500 = 3000`), evidenciando que la cascada es multiplicativa.

### Requerimiento 4: Único redondeo, tope con floor y totales derivados

**User Story:** Como responsable del cálculo, quiero un solo punto de redondeo y un tope aplicado
con floor, para que el ahorro nunca supere el 35% y el total final no se desincronice del
desglose.

#### Acceptance Criteria

1. EL Ensamblador DEBERÁ calcular `rawDiscountCents` como `roundHalfUp(rawDiscountMicros)`, y
   esta DEBERÁ ser la **única** operación de redondeo o truncamiento sobre montos de la cascada
   en todo el Paquete_Shared.
2. EL Ensamblador DEBERÁ calcular `capCents` como `Math.floor(originalSubtotalCents × 3500 /
   10000)`, usando siempre floor y nunca ceil ni half-up.
3. EL Ensamblador DEBERÁ calcular `totalSavingsCents` como
   `Math.min(rawDiscountCents, capCents)`.
4. EL Ensamblador DEBERÁ fijar `capApplied` en `true` si y solo si `rawDiscountCents` es
   **estrictamente mayor** que `capCents`, de modo que la igualdad exacta —un descuento de
   exactamente el 35%— produzca `capApplied: false`.
5. EL Ensamblador DEBERÁ derivar `finalTotalCents` como
   `originalSubtotalCents − totalSavingsCents`, sin calcularlo por ninguna otra vía, cumpliendo
   `finalTotalCents + totalSavingsCents === originalSubtotalCents` para toda entrada válida.
6. EL Ensamblador DEBERÁ calcular `effectiveDiscountBps` como
   `Math.round(totalSavingsCents × 10000 / originalSubtotalCents)`, entero de `0` a `3500`; y SI
   `originalSubtotalCents` es `0`, ENTONCES DEBERÁ fijarlo en `0` sin ejecutar la división.
7. DONDE el Motor se construye con el Factory, EL Ensamblador DEBERÁ emitir `lines` con
   exactamente tres elementos en el orden `CATEGORY`, `VOLUME`, `COUPON`, y cada regla no
   aplicable DEBERÁ llevar su `name`, un `label` no vacío, `applied: false` y todos sus montos en
   `0`.
8. EL Ensamblador DEBERÁ calcular el `discountCents` de cada línea como
   `Math.floor(discountMicros / MICRO)` y repartir la diferencia contra `rawDiscountCents` de a un
   centavo en orden descendente de resto —ante restos iguales, en el orden de precedencia—, de
   modo que la suma de los `discountCents` iguale exactamente `rawDiscountCents`, **también
   cuando `capApplied` es `true`**; en ese caso `rawDiscountCents − totalSavingsCents` es el monto
   truncado.
9. CUANDO se calcula 1 × `PROD-001` con `WELCOME2026`, EL Ensamblador DEBERÁ producir
   `originalSubtotalCents` `129900`, `discountCents` de línea `12990`, `5845` y `16660`,
   `rawDiscountCents` `35495`, `capCents` `45465`, `capApplied` `false`, `totalSavingsCents`
   `35495`, `effectiveDiscountBps` `2732` y `finalTotalCents` `94405`.
10. CUANDO el carrito no tiene líneas o `originalSubtotalCents` es `0`, EL Ensamblador DEBERÁ
    emitir todos los totales en `0` con `capApplied: false` y las líneas de las estrategias
    recibidas con `applied: false`, sin lanzar excepción; y en todos los casos DEBERÁ emitir cada
    campo `*Cents`, `*Micros` y `*Bps` como entero no negativo verificable con `Number.isInteger`.

### Requerimiento 5: Carritos inválidos y errores tipados

**User Story:** Como consumidor del motor, quiero que un carrito corrupto falle con un error
tipado y que un carrito vacío devuelva cero sin excepción, para distinguir el dato inválido del
caso legítimo sin descuento.

#### Acceptance Criteria

1. SI una línea declara `quantity` menor o igual a `0`, o que no sea entero finito —fraccionario,
   `NaN`, `Infinity`—, ENTONCES EL Motor DEBERÁ lanzar un error tipado con `code`
   `'INVALID_CART'` y `details` que identifique el índice de la línea y el valor rechazado, sin
   devolver totales.
2. SI un producto declara `priceCents` que no sea entero finito mayor o igual a `0`, ENTONCES EL
   Motor DEBERÁ lanzar `'INVALID_CART'` con `details` que identifique el `productId` y el valor.
3. SI una línea referencia un `productId` ausente del catálogo del contexto, comparado por
   igualdad exacta de cadena, ENTONCES EL Motor DEBERÁ lanzar `'PRODUCT_NOT_FOUND'` con `details`
   que incluya el `productId` no resuelto.
4. SI el código de cupón está ausente, vacío, no registrado o expirado, ENTONCES EL Motor DEBERÁ
   completar la cascada con las reglas restantes y reportar la línea `COUPON` con
   `applied: false` y montos en `0`, **sin lanzar excepción**.
5. EL error tipado DEBERÁ exponer `code: ErrorCode`, `message` no vacío y `details` opcional de
   tipo `Record<string, unknown>`, sin importar NestJS, sin exponer códigos HTTP y sin depender
   de Prisma.
6. SI la suma de `priceCents × quantity` excede `9_000_000_000` centavos —cota de exactitud de la
   escala frente a `Number.MAX_SAFE_INTEGER`—, ENTONCES EL Motor DEBERÁ lanzar `'INVALID_CART'`.
7. CUANDO EL Motor valida, DEBERÁ recorrer las líneas en orden ascendente de índice y, dentro de
   cada una, resolver primero el `productId` y validar después `quantity` y `priceCents`,
   lanzando **únicamente el primer error detectado**, sin ejecutar ninguna estrategia, sin
   devolver totales parciales y sin mutar el carrito, el catálogo ni el cupón.

### Requerimiento 6: Suite de pruebas y cobertura

**User Story:** Como responsable de calidad, quiero los casos borde cubiertos de forma
determinista y el motor medido con su propio umbral, para que el desglose sea auditable y las
regresiones de redondeo fallen de inmediato.

#### Acceptance Criteria

1. EL Suite DEBERÁ declarar en la configuración de Vitest del propio workspace un umbral de
   cobertura de `80` por ciento en líneas y `80` en ramas, medido sobre los módulos del motor,
   sus estrategias, la factory y las utilidades de dinero, excluyendo los archivos de prueba y
   los que solo contienen tipos, sin depender de la configuración de otros workspaces.
2. SI la cobertura de líneas o de ramas resulta estrictamente menor a `80`, ENTONCES EL Suite
   DEBERÁ terminar con código distinto de cero indicando qué métrica quedó corta y con qué
   porcentaje; exactamente `80` en ambas DEBERÁ aprobar.
3. DONDE el caso del tope se produce por inyección, EL Suite DEBERÁ pasar estrategias stub al
   constructor del Motor, tipadas contra `DiscountStrategy`, con tasas en bps enteros, sin `any`,
   sin `as` de silenciamiento y sin `@ts-ignore`.
4. EL Suite DEBERÁ cubrir por inyección los cuatro casos del tope: exceso —afirmando
   `capApplied === true`, `totalSavingsCents === capCents` y
   `finalTotalCents === originalSubtotalCents − totalSavingsCents`—, `capCents − 1`, `capCents` y
   `capCents + 1`, afirmando que la igualdad exacta **no** activa el truncamiento.
5. EL Suite DEBERÁ incluir un test de redondeo con el fixture 1 × `PROD-001` + `WELCOME2026` que
   afirme `totalSavingsCents === 35495`, `capApplied === false` y las `discountCents` por línea
   `12990`, `5845` y `16660`, de modo que una política half-up por paso, que daría `35496`, haga
   fallar el test.
6. EL Suite DEBERÁ afirmar que la suma de las `discountCents` iguala `rawDiscountCents`, con al
   menos un caso donde el reparto asigna un centavo sobrante y uno con `capApplied === true` donde
   la diferencia contra `totalSavingsCents` es exactamente el truncamiento.
7. EL Suite DEBERÁ cubrir la frontera del volumen con dos casos: remanente tras `CATEGORY` de
   exactamente `10000` centavos → `VOLUME` con `applied === false` y `discountMicros === 0`; y de
   `10001` → `applied === true` con `discountMicros === baseAmountMicros × 500 / 10000`.
8. EL Suite DEBERÁ cubrir el cupón de demo `DEMOCAP50` sobre productos del catálogo dentro de
   stock, afirmando `capApplied === true` y `totalSavingsCents === capCents`; y un barrido de las
   cuatro variantes del enunciado —sin cupón, `WELCOME2026`, `SUMMER2024` y un código no
   registrado, **excluyendo** `DEMOCAP50`— afirmando `capApplied === false` y
   `rawDiscountCents <= capCents` en todas.
9. EL Suite DEBERÁ cubrir el carrito vacío sobre un Motor armado desde el Factory (totales en `0`
   y tres líneas con `applied === false`, sin excepción); el carrito corrupto (`'INVALID_CART'`
   para cantidad negativa y precio inválido, `'PRODUCT_NOT_FOUND'` para `productId` ausente, sin
   totales parciales); y el cupón expirado o no registrado (sin excepción, `COUPON` en `false` y
   `CATEGORY` / `VOLUME` con los montos que tendrían sin cupón).
10. EL Suite DEBERÁ ejecutar todos estos casos de forma determinista y aislada, sin levantar la
    API ni la base de datos, con montos fijos en centavos enteros y sin valores aleatorios ni
    dependientes de la fecha del sistema.
