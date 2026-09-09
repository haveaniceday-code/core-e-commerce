---
inclusion: always
---

# Arquitectura y Patrones de Diseño

El código es modular, con separación estricta de responsabilidades. El objetivo central es
aislar las reglas matemáticas del motor de descuentos de la persistencia y de los
controladores HTTP.

## Principio rector: el motor de descuentos es puro

- El motor recibe un carrito y un cupón, y devuelve un desglose. No conoce NestJS, ni
  Prisma, ni HTTP.
- Vive en `packages/shared/src/discount/`, por lo que es testeable en aislamiento y
  reutilizable desde el backend y el frontend.
- Los controllers solo orquestan: reciben el request, delegan al servicio y responden. No
  contienen lógica de negocio.
- La persistencia se accede detrás de interfaces de repositorio (`ProductRepository`,
  `OrderRepository`), de modo que la lógica no depende de Prisma.

## Hallazgo: el tope del 35% es matemáticamente inalcanzable

Con las tres reglas del descuento, el descuento máximo posible de la cascada es:

```
1 − (0.90 × 0.95 × 0.85) = 0.27325  →  27.325%
```

y eso solo en un carrito 100% Tecnología, porque la regla de categoría opera únicamente
sobre esos productos. En carritos mixtos el descuento efectivo es menor.

Consecuencias de diseño, que son deliberadas:

1. **El tope es un invariante defensivo, no un paso alcanzable de la cascada.** Se
   implementa igualmente y se verifica igualmente, porque protege el margen ante cualquier
   regla futura. Pero no es un camino que los datos reales recorran.
2. **El motor acepta la lista de estrategias por inyección.** No la construye internamente
   a partir de un catálogo fijo. Esto no es un detalle de conveniencia: es la única forma
   de probar el invariante del tope, inyectando una estrategia stub con una tasa alta que
   sí lo haga superar el 35%. La testabilidad del invariante es un requisito de la firma
   del motor.
3. **Para demostrar la Alerta de Descuento Límite Alcanzado  existe el cupón de demo `DEMOCAP50`**, declarado en
   `product-rules.md` y marcado explícitamente como extensión ajena al enunciado. Las
   reglas quedan intactas; `WELCOME2026` conserva su 15%.

Este hallazgo se documenta en `docs/arquitectura.md`.

## Patrones de diseño implementados

### Strategy — cálculo de descuentos

Cada regla de descuento es una estrategia intercambiable con una interfaz común:

```ts
interface DiscountStrategy {
  readonly name: DiscountName;
  readonly order: number;
  isApplicable(ctx: DiscountContext): boolean;
  apply(ctx: DiscountContext): DiscountResult;
}
```

Estrategias: `CategoryDiscount` (10% sobre los productos `Tecnologia`), `VolumeDiscount`
(5% cuando el subtotal supera los 100 USD) y `CouponDiscount` (15% con `WELCOME2026`).

El motor recibe las estrategias como dependencia:

```ts
class DiscountEngine {
  constructor(private readonly strategies: readonly DiscountStrategy[]) {}
  calculate(ctx: DiscountContext): CheckoutTotals { /* ... */ }
}
```

### Factory — instanciación de estrategias

`DiscountStrategyFactory` construye la lista ordenada de estrategias aplicables según el
contexto. Añadir una regla nueva no requiere modificar el motor. En producción el motor se
arma desde la factory; en los tests del invariante se le inyecta una lista arbitraria.

### Repository — acceso a datos

`ProductRepository` y `OrderRepository` se definen como interfaces en la capa de dominio.
La implementación concreta vive en infraestructura. Los tests unitarios usan
implementaciones en memoria como dobles de prueba.

## Orden de precedencia del motor

1. **Categoría:** 10% de descuento sobre los productos de categoría `Tecnologia`.
2. **Volumen:** 5% sobre todo el carrito cuando el subtotal, ya aplicada la regla 1, supera
   estrictamente los 100 USD.
3. **Cupón:** 15% sobre el total resultante de la regla 2, cuando el cupón `WELCOME2026`
   es válido.
4. **Límite absoluto:** el descuento total nunca supera el 35% del valor original. Si la
   cascada excede ese porcentaje, el descuento se trunca exactamente en 35%. Ver el
   hallazgo de arriba: es un invariante, no un camino alcanzable.

La cascada es multiplicativa: cada regla se aplica sobre el total que dejó la regla
anterior, no sobre el subtotal original. La cascada corre en **aritmética exacta
(micro-centavos) y no redondea en ningún paso**; el redondeo es único y ocurre al final,
después de la cascada y antes de aplicar el tope. Los umbrales exactos, la política de
redondeo completa y el catálogo están en `product-rules.md`.

Esto tiene una consecuencia de diseño: las estrategias de descuento **devuelven montos
exactos, no redondeados**. El redondeo no vive en las estrategias sino en el ensamblador de
totales del motor, que es el único punto del sistema autorizado a redondear.

El backend es la fuente de verdad del cálculo. Aunque el frontend muestre un desglose en
vivo, lo obtiene de `POST /api/checkout/preview`; el backend recalcula todo durante el
checkout y no confía en los montos que envía el cliente.

Por eso el redondeo es consistente entre capas por construcción, no por convención: existe
una sola implementación en `packages/shared`, el frontend no redondea montos calculados y
`preview` y `checkout` invocan exactamente el mismo motor.

## Separación de capas en el backend

```
controller  → orquesta HTTP y valida el DTO de entrada
  service   → caso de uso: valida stock, invoca el motor, persiste
    domain  → entidades e interfaces de repositorio
    infra   → implementación Prisma de los repositorios
```
