---
inclusion: always
---

# Estándares de Pruebas

La cobertura mínima es del **80%** en las capas lógicas esenciales. El umbral es
innegociable y debe romper el comando de test cuando no se cumple.

## Umbral de cobertura

- Mínimo 80% de líneas y ramas en:
  - **Backend:** motor de descuentos, validaciones de stock y servicio de checkout.
  - **Frontend:** estado del carrito, aplicación de cupón y lógica de la alerta del 35%.
- `coverageThreshold` configurado en Jest y en Vitest, de forma que el comando falle por
  debajo del 80%. Medir no es suficiente: el comando debe fallar.

## Casos borde obligatorios

El motor de descuentos y el checkout tienen tests para todos estos casos:

1. Descuento en cascada que supera el 35%, con truncamiento exacto en 35%.
2. Frontera del 35%: un caso justo por debajo y otro justo por encima.
3. Carrito vacío, que devuelve descuento cero sin lanzar excepción.
4. Carrito con datos corruptos (cantidad negativa, precio inválido, producto inexistente),
   que falla con un error tipado.
5. Cupón no registrado o expirado, que se ignora sin interrumpir el resto del cálculo.
6. Cupón `WELCOME2026` válido, que aplica 15% en su orden de precedencia.
7. Stock insuficiente, que rechaza el checkout sin decrementar stock ni persistir la orden.

Casos de cálculo en cascada que también se cubren:

- Solo descuento de categoría.
- Categoría más volumen.
- Las tres reglas combinadas.
- Verificación de que la cascada es multiplicativa y no una suma de porcentajes.

## Filosofía

- El motor de descuentos se testea de forma aislada, sin levantar la API ni la base de
  datos.
- Los tests son deterministas, con montos fijos cuyos resultados se pueden verificar a
  mano.
- Los tests se escriben junto con la lógica, no al final.
- Los dobles de prueba también van tipados: no se usa `any` en mocks.
