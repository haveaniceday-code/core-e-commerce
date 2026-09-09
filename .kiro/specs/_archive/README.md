# Specs archivadas

## `monorepo-shared-discount-engine`

Spec original, reemplazada el 2026-09-09 por la cadena de tres specs
`monorepo-foundation` → `shared-contracts-seed` → `discount-engine`.

Se conserva porque la bitácora de co-creación y los commits anteriores la referencian por
nombre, y porque su numeración original (R1–R13) es la que aparece en las tablas de
*Trazabilidad con la spec original* de las tres specs nuevas.

**No es la fuente de verdad.** Cualquier trabajo se hace contra las tres specs activas.

### Motivo de la partición

- Un solo spec cubría tres alcances (raíz del monorepo + contratos/seed/dinero + motor), que es
  lo que el propio nombre delataba.
- 1896 líneas antes de la primera línea de TypeScript, con 415 de esas líneas siendo cuerpos de
  función dentro de `design.md` — código que habría que mantener en dos lugares.
- La tabla del catálogo y de los cupones aparecía tres veces: en `product-rules.md` (steering,
  canónica), en los criterios de aceptación y en la sección *Data Models* del diseño.
- Varios criterios verificaban comportamiento documentado de npm y de git en lugar de
  comportamiento del sistema.
