---
inclusion: always
---

# Reglas de Tipado Estricto

El tipado es estricto de extremo a extremo. Estas reglas aplican a todo el código generado
o modificado.

## Prohibiciones

- No usar `any`. Preferir `unknown` con narrowing, genéricos o tipos de unión.
- No usar type assertions (`as`) para silenciar errores del compilador. Si aparece un error
  de tipos, se corrige el tipo, no se oculta.
- No usar `@ts-ignore` ni `@ts-expect-error`.

## Obligaciones

- `strict: true`, `noImplicitAny: true` y `strictNullChecks: true` en todos los
  `tsconfig.json`.
- Los montos de dinero se manejan siempre en **centavos como enteros**. Nunca se opera ni
  se compara con números de punto flotante.
- Los DTOs de entrada del backend se validan con class-validator, porque el tipado de
  TypeScript no valida en runtime.
- Uniones de literales para valores cerrados, por ejemplo las categorías de producto:
  `'Tecnologia' | 'Hogar' | 'Ropa'`.
- Las respuestas de la API usan contratos explícitos importados desde `packages/shared`.

## Al generar código

Si un tipo parece requerir `any`, detente y explica en el chat por qué, y propón la
alternativa tipada antes de escribir el código.
