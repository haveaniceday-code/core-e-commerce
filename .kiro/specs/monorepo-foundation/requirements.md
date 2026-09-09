# Requirements Document

## Introduction

Andamiaje del monorepo y del workspace `packages/shared`: raíz con npm workspaces, TypeScript
compartido, esqueleto del paquete sin dependencias de runtime, régimen de tipado estricto y arnés
de pruebas.

Aquí no se escribe lógica de dominio. Sí quedan fijadas las reglas que las specs siguientes no
pueden violar, porque son más baratas de imponer antes de que exista el código que corregir.

**Cadena de specs:** `monorepo-foundation` → `shared-contracts-seed` → `discount-engine`. Las
referencias entre specs llevan prefijo (`MF-`, `SCS-`, `DE-`); dentro de un documento, `R2.4` es
"Requerimiento 2, criterio 4" de ese mismo spec. Criterios en EARS.

**Fuera de alcance:** `apps/backend`, `apps/frontend` y todo el contenido de
`packages/shared/src/`. El patrón `apps/*` se declara para que esos paquetes encajen después,
pero la carpeta queda vacía.

## Requirements

### Requerimiento 1: Raíz del monorepo con npm workspaces

**User Story:** Como desarrollador, quiero una raíz con workspaces y TypeScript compartido, para
que cada paquete herede el mismo tipado estricto sin duplicar configuración.

#### Acceptance Criteria

1. LA Raíz DEBERÁ declarar en `package.json` `private: true` y `workspaces` como los dos
   patrones `apps/*` y `packages/*`, sin patrones adicionales.
2. LA Raíz DEBERÁ proveer `tsconfig.base.json` con `strict`, `noImplicitAny` y
   `strictNullChecks` en `true`, siendo la única fuente donde se declaran esos tres flags.
3. EL Paquete_Shared DEBERÁ extender `tsconfig.base.json` con `extends` y no DEBERÁ redeclarar
   esos tres flags con valor `false`.
4. CUANDO un desarrollador ejecuta `npm run test:cov` en la Raíz, LA Raíz DEBERÁ ejecutar en
   secuencia el `test:cov` de cada workspace que lo defina y terminar en cero solo si todos
   terminan en cero.
5. SI el `test:cov` de un workspace falla, ENTONCES LA Raíz DEBERÁ detener la secuencia,
   identificar el workspace que falló y terminar con código distinto de cero.

### Requerimiento 2: Pureza y tipado estricto de `packages/shared`

**User Story:** Como desarrollador, quiero el paquete libre de dependencias de framework y sin
escapes de tipado, para poder testear el motor en aislamiento y consumirlo desde ambos lados.

#### Acceptance Criteria

1. EL Paquete_Shared DEBERÁ declarar cero dependencias de runtime —solo devDependencies de
   compilación y prueba— y cero `import` o `require` hacia NestJS, Prisma, clientes HTTP o
   cualquier API de red o de sistema de archivos, en producción y en pruebas.
2. CUANDO se ejecuta `tsc --noEmit` sobre el Paquete_Shared, DEBERÁ terminar con cero errores de
   tipo, y con código distinto de cero ante el primer error, sin emitir artefactos.
3. EL Paquete_Shared DEBERÁ derivar cada conjunto cerrado de valores desde un único arreglo
   `as const`, sin uniones de literales escritas a mano que los dupliquen.
4. EL Paquete_Shared DEBERÁ mantener cero `any`, cero type assertions distintas de `as const`,
   cero `@ts-ignore` y cero `@ts-expect-error`, incluidos los dobles de prueba.
5. EL Paquete_Shared DEBERÁ comparar la categoría de producto contra el literal sin tilde y
   reservar la cadena con tilde solo como etiqueta de presentación, con cero comparaciones contra
   la etiqueta (literales en `SCS-R1.1` y `SCS-R1.2`).
6. SI aparece una importación prohibida, un `any`, una assertion distinta de `as const` o un
   comentario `@ts-`, ENTONCES EL script `lint` del workspace DEBERÁ terminar con código distinto
   de cero e identificar archivo, línea y elemento prohibido.

### Requerimiento 3: Arnés de pruebas del workspace

**User Story:** Como responsable de calidad, quiero el runner configurado antes de la primera
prueba, para que ninguna spec posterior pueda dar por aprobada una ejecución que no probó nada.

#### Acceptance Criteria

1. CUANDO se invoca `npm run test:cov --workspace packages/shared`, EL Arnés DEBERÁ ejecutar
   Vitest en modo de ejecución única, sin watch ni interacción, y emitir el reporte de cobertura
   de líneas y ramas.
2. SI una prueba falla o la ejecución termina por un error no controlado, ENTONCES EL Arnés
   DEBERÁ terminar con código distinto de cero, con independencia de la cobertura.
3. SI no se descubre ningún archivo de prueba, ENTONCES EL Arnés DEBERÁ terminar con código
   distinto de cero en lugar de reportar la ejecución como aprobada.

> El umbral de cobertura del 80% no se declara aquí: se mide sobre los módulos del motor, que
> todavía no existen. Vive en `DE-R6`.
