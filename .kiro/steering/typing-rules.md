---
inclusion: always
---

# Reglas de Tipado Estricto

El tipado es estricto de extremo a extremo. Estas reglas aplican a todo el código generado
o modificado.

## Prohibiciones

- No usar `any`. Preferir `unknown` con narrowing, genéricos o tipos de unión.
- No usar type assertions (`as`) para **silenciar errores del compilador**. Si aparece un
  error de tipos, se corrige el tipo, no se oculta.
- No usar `@ts-ignore` ni `@ts-expect-error`.

### Excepción: `as const`

`as const` **sí está permitido y es la forma preferida** de derivar uniones de literales a
partir de un valor. No es una aserción que silencie un error: estrecha el tipo, no lo
ensancha.

```ts
export const PRODUCT_CATEGORIES = ['Tecnologia', 'Hogar', 'Ropa'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
```

Prohibidas siguen las aserciones que ensanchan o mienten: `as unknown as T`, `as any`, o un
`as T` sobre un valor que el compilador no puede verificar.

## Obligaciones

- `strict: true`, `noImplicitAny: true` y `strictNullChecks: true` en todos los
  `tsconfig.json`.
- Los montos de dinero se manejan siempre en **enteros**: centavos en los contratos y
  micro-centavos (`MICRO = 1_000_000`) dentro de la cascada del motor. Nunca se opera ni se
  compara con punto flotante, y **no hay excepción para las tasas**: se expresan en puntos
  básicos enteros (`1000`, `500`, `1500`, tope `3500`) y se aplican como `× bps / 10000`.
- La cascada **no redondea en ningún paso intermedio**. El redondeo es único y final, según
  la política de `product-rules.md`. Un `Math.round` dentro de una estrategia de descuento
  es un error de implementación, no una decisión de estilo.
- Los DTOs de entrada del backend se validan con class-validator, porque el tipado de
  TypeScript no valida en runtime.
- Uniones de literales para valores cerrados. La categoría de producto es
  `'Tecnologia' | 'Hogar' | 'Ropa'`, **sin tilde en el literal**; la tilde vive solo en la
  etiqueta de UI (ver `product-rules.md`). Comparar contra la etiqueta en vez del literal
  produce un fallo silencioso.
- Las respuestas de la API usan contratos explícitos importados desde `packages/shared`.

## Al generar código

Si un tipo parece requerir `any`, detente y explica en el chat por qué, y propón la
alternativa tipada antes de escribir el código.
