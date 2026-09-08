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

Estrategias: `CategoryDiscount` (10% en Tecnología), `VolumeDiscount` (5% sobre 100 USD) y
`CouponDiscount` (15% con `WELCOME2026`).

### Factory — instanciación de estrategias

`DiscountStrategyFactory` construye la lista ordenada de estrategias aplicables según el
contexto. Añadir una regla nueva no requiere modificar el motor.

### Repository — acceso a datos

`ProductRepository` y `OrderRepository` se definen como interfaces en la capa de dominio.
La implementación con Prisma vive en infraestructura. Los tests unitarios usan
implementaciones en memoria como dobles de prueba.

## Orden de precedencia del motor

1. **Categoría:** 10% de descuento sobre los productos de categoría Tecnología.
2. **Volumen:** 5% sobre todo el carrito cuando el subtotal, ya aplicada la regla 1, supera
   los 100 USD.
3. **Cupón:** 15% sobre el total resultante de la regla 2, cuando el cupón `WELCOME2026`
   es válido.
4. **Límite absoluto:** el descuento total nunca supera el 35% del valor original. Si la
   cascada excede ese porcentaje, el descuento se trunca exactamente en 35%.

La cascada es multiplicativa: cada regla se aplica sobre el total que dejó la regla
anterior, no sobre el subtotal original.

El backend es la fuente de verdad del cálculo. Aunque el frontend muestre un desglose en
vivo, el backend recalcula todo durante el checkout y no confía en los montos que envía el
cliente.

## Separación de capas en el backend

```
controller  → orquesta HTTP y valida el DTO de entrada
  service   → caso de uso: valida stock, invoca el motor, persiste
    domain  → entidades e interfaces de repositorio
    infra   → implementación Prisma de los repositorios
```
