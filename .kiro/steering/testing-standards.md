---
inclusion: always
---

# Estándares de Pruebas

La cobertura mínima es del **80%** en las capas lógicas esenciales. El umbral es
innegociable y debe romper el comando de test cuando no se cumple.

## Alcance de la cobertura por workspace

El motor de descuentos vive en `packages/shared`, **no** en `apps/backend`. Un
`coverageThreshold` configurado solo en el backend no mide el motor, que es la pieza más
importante. Cada workspace tiene su propia configuración de cobertura:

| workspace | runner | qué cubre | comando |
|-----------|--------|-----------|---------|
| `packages/shared` | Vitest | Motor de descuentos, estrategias, factory, redondeo | `npm run test:cov --workspace packages/shared` |
| `apps/backend` | Jest | Servicio de checkout, validación de stock, controllers | `npm run test:cov --workspace apps/backend` |
| `apps/frontend` | Vitest + RTL | Estado del carrito, aplicación de cupón, alerta del 35% | `npm run test:cov --workspace apps/frontend` |

En la raíz existe `npm run test:cov`, que ejecuta los tres en secuencia y falla si
cualquiera queda por debajo del umbral.

Los tres tienen `coverageThreshold` de 80% en líneas y ramas. Medir no es suficiente: el
comando debe fallar.

## Casos borde obligatorios

El motor de descuentos y el checkout tienen tests para todos estos casos:

1. Cascada que supera el 35%, con truncamiento exacto en 35%.
2. Frontera del 35%: un caso justo por debajo y otro justo por encima.
3. Carrito vacío, que devuelve descuento cero sin lanzar excepción.
4. Carrito con datos corruptos (cantidad negativa, precio inválido, producto inexistente),
   que falla con un error tipado.
5. Cupón no registrado o expirado, que se ignora sin interrumpir el resto del cálculo.
6. Cupón `WELCOME2026` válido, que aplica 15% en su orden de precedencia.
7. Stock insuficiente, que rechaza el checkout sin decrementar stock ni persistir la orden.
8. **Frontera del volumen:** subtotal tras la regla de categoría de exactamente `10000`
   centavos **no** activa el 5%; `10001` sí. El umbral es estrictamente mayor.

Casos de cálculo en cascada que también se cubren:

- Solo descuento de categoría.
- Categoría más volumen.
- Las tres reglas combinadas.
- Verificación de que la cascada es multiplicativa y no una suma de porcentajes.
- Carrito mixto, donde la regla de categoría opera solo sobre los productos `Tecnologia` y
  no sobre el carrito completo.

## Cómo se prueba el tope del 35%

Los casos 1 y 2 **no se pueden producir con las reglas reales**: el máximo alcanzable es
27.325% (ver `architecture.md`). Por lo tanto:

- Se prueban **inyectando una lista de estrategias stub** en `DiscountEngine`, con tasas
  altas que hagan superar el tope. Es el test del invariante, y es la razón por la que el
  motor recibe las estrategias por constructor.
- Adicionalmente se prueba con el cupón de demo `DEMOCAP50` sobre el catálogo real, que es
  el camino que demuestra la alerta de descuento límite alcanzado.
- Un test explícito verifica que **con el catálogo y los cupones del enunciado el tope
  nunca se activa** (`capApplied === false` en todos los casos). Ese test documenta el
  hallazgo y falla si alguien cambia las tasas sin revisarlo.

## Determinismo y redondeo

- Los montos de prueba van en centavos enteros y se eligen para que el resultado sea
  verificable a mano.
- Los tests aplican la política de `product-rules.md`: **cascada exacta en micro-centavos,
  un único redondeo half-up al final, floor en el tope**. Un test que espere `8478.75` está
  mal escrito; el valor esperado es el entero que resulta de redondear una sola vez, al
  final.
- Hay al menos un test dedicado al redondeo, con un carrito cuya cascada produce fracciones
  de centavo en **más de un paso**. Ese test es la defensa contra una regresión a redondeo
  en cascada: está construido de forma que redondear paso a paso dé un resultado distinto y
  por tanto falle.

  Fixture canónico (verificado): **1 × `PROD-001` + `WELCOME2026`**.

  | paso | valor exacto | half-up por paso (incorrecto) |
  |------|--------------|-------------------------------|
  | subtotal original | `129900` | `129900` |
  | categoría 10% | `12990` | `12990` |
  | volumen 5% | `5845.5` | `5846` |
  | cupón 15% | `16659.675` | `16660` |
  | **descuento total** | `35495.175` → **`35495`** | **`35496`** |

  El valor esperado es `totalSavingsCents === 35495`. Un motor que redondee en cascada
  devuelve `35496` y el test falla, que es exactamente su propósito. Sobre el catálogo y el
  cupón del enunciado, el 10.5% de los carritos posibles diverge entre ambas políticas: no
  es un caso rebuscado.

  El mismo fixture cubre el reparto por mayor resto: las líneas exactas son
  `12990`, `5845.5` y `16659.675`; sus pisos suman `35494`, y el centavo restante va a la
  línea de cupón por tener el mayor resto (`.675`), dando `12990 + 5845 + 16660 = 35495`.
- Un test verifica que las `discountCents` de las líneas **suman exactamente**
  `rawDiscountCents`, incluyendo un caso donde el reparto por mayor resto tiene que asignar
  el centavo sobrante.
- Un test de consistencia frontend/backend afirma que la UI renderiza los mismos enteros
  que devuelve `CheckoutTotals`, sin recalcular ni reformatear por su cuenta.

## Filosofía

- El motor de descuentos se testea de forma aislada, sin levantar la API ni la base de
  datos.
- Los tests son deterministas, con montos fijos cuyos resultados se pueden verificar a
  mano.
- Los tests se escriben junto con la lógica, no al final.
- Los dobles de prueba también van tipados: no se usa `any` en mocks.
