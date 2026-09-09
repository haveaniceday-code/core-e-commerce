# Configuración de Kiro

Resumen de cómo se usa IA en este proyecto: las reglas que la guían y los artefactos que la
automatizan.

## Steering (`.kiro/steering/`)

Los cinco archivos se cargan siempre (`inclusion: always`), así que aplican a toda
generación de código.

| archivo | qué gobierna |
|---------|--------------|
| `tech-stack.md` | Stack, estructura del monorepo, workspaces |
| `architecture.md` | Capas, patrones de diseño, hallazgo del tope inalcanzable |
| `product-rules.md` | Catálogo, cupones, umbrales, redondeo, contrato REST, textos de UI |
| `typing-rules.md` | Tipado estricto, prohibición de `any`, excepción `as const` |
| `testing-standards.md` | Umbral del 80% por workspace y casos borde obligatorios |

Se separaron por tema en lugar de un archivo único para que un cambio de reglas de negocio no toque las reglas
de tipado.

## Skill (`.kiro/skills/`)

`generate-unit-tests` — genera suites de tests unitarios apuntando al 80% de cobertura,
eligiendo el runner según la capa (Vitest en `packages/shared` y frontend, Jest en backend)
y cubriendo los casos borde del motor y del checkout con dobles de prueba tipados.

## Agente (`.kiro/agents/`)

`test-coverage-auditor` — auditor independiente de cobertura. Ejecuta las suites, verifica
el 80% por área y comprueba que cada caso borde tenga un test real. No escribe código: solo
lee, ejecuta y reporta. Rechaza cuando falta un caso borde aunque el porcentaje global
pase, y señala la cobertura inflada (líneas ejecutadas sin asserts sobre el resultado).

La separación es deliberada: quien escribe los tests no es quien los aprueba.

## Specs (`.kiro/specs/`)

Vacío por ahora.
