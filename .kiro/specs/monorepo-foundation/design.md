# Design Document

## Overview

Andamiaje, no dominio. Al cerrar esta spec, `packages/shared/src/` está vacío y lo que está
operativo es la maquinaria que hace fallar el build ante un `any`, una importación de NestJS o
una suite sin pruebas.

**Principio rector:** las prohibiciones se instalan antes que el código que las violaría. Un
`any` detectado el mismo día que se escribe cuesta una corrección local; detectado al final,
cuesta una auditoría.

## Architecture

```
core-e-commerce/
├── package.json              # private, workspaces, scripts agregadores (R1.1, R1.4)
├── tsconfig.base.json        # única fuente de los tres flags estrictos (R1.2)
├── .gitignore                # node_modules, dist, coverage, *.db
├── apps/                     # vacío; el patrón apps/* no resuelve nada todavía
└── packages/shared/
    ├── package.json          # sin dependencies, solo devDependencies (R2.1)
    ├── tsconfig.json         # extends ../../tsconfig.base.json (R1.3)
    ├── eslint.config.mjs     # prohibiciones de tipado e importación (R2.4, R2.6)
    ├── tsconfig.build.json   # excluye *.spec.ts del artefacto publicado
    ├── vitest.config.ts      # ejecución única, passWithNoTests:false (R3.1, R3.3)
    └── src/index.ts          # fachada vacía; la pueblan las specs 2 y 3
```

## Components and Interfaces

### Raíz

```jsonc
// package.json
{
  "name": "core-e-commerce",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "build":     "npm run build --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint":      "npm run lint --workspaces --if-present",
    "test":      "npm run test --workspaces --if-present",
    "test:cov":  "npm run test:cov --workspaces --if-present"
  }
}
```

`--workspaces --if-present` cumple R1.4 y R1.5 sin scripting propio: npm recorre los workspaces
en el orden de los patrones, se detiene en el primer fallo, imprime cuál falló y propaga el
código de salida. Los patrones que no resuelven paquetes —hoy `apps/*`— se omiten sin error.

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "strict": true, "noImplicitAny": true, "strictNullChecks": true,
    "target": "ES2022", "lib": ["ES2022"],
    "module": "CommonJS", "moduleResolution": "node",
    "declaration": true, "declarationMap": true, "sourceMap": true,
    "esModuleInterop": true, "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

**CommonJS y no ESM.** NestJS emite CommonJS por defecto, y mezclar un `packages/shared` ESM
dentro de un backend CJS obliga a `createRequire`, a `await import()` o a un bundler configurado
a mano. Vite y Vitest consumen CJS sin fricción, así que CommonJS es el formato que hace que las
tres piezas encajen sin trabajo extra. Es una decisión de interoperabilidad para este MVP, no una
preferencia: un paquete publicado de verdad ofrecería ambos formatos vía `exports`.

Las dos últimas opciones no son decorativas y miran hacia las specs siguientes:
`noUncheckedIndexedAccess` obliga a *narrowing* al indexar catálogo y líneas, de modo que el
reparto por mayor resto (`SCS-R3.6`) no pueda asumir que un índice existe;
`exactOptionalPropertyTypes` hace que `details?:` signifique "ausente" y no "presente con
`undefined`", que es lo que exige `ApiError` (`SCS-R1.7`).

### Paquete

```jsonc
// packages/shared/package.json — sin campo "dependencies" (R2.1)
{
  "name": "@core/shared", "private": true,
  "main": "./dist/index.js", "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --max-warnings 0",
    "test": "vitest run",
    "test:cov": "vitest run --coverage"
  }
}
```

El paquete se compila a `dist/` y se consume desde ahí, no desde `src/`: es lo que permite a
NestJS resolverlo sin `ts-node` ni alias de bundler. `tsconfig.build.json` extiende el
`tsconfig.json` del workspace y solo añade `exclude: ["src/**/*.spec.ts"]`, para que los tests no
viajen en el artefacto.

El campo `dependencies` está **ausente**, no vacío: la ausencia hace evidente en la revisión que
el paquete no tiene runtime propio.

**ESLint 9 en flat config** (`eslint.config.mjs`), con `typescript-eslint` en modo
`recommendedTypeChecked` —las reglas `no-unsafe-*` necesitan información de tipos, así que se
habilita `projectService`—:

| Regla | Prohíbe |
|-------|---------|
| `no-explicit-any` + `no-unsafe-*` | `any` explícito e implícito |
| `ban-ts-comment` | `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` |
| `consistent-type-assertions` con `assertionStyle: 'never'` | toda type assertion |
| `no-restricted-imports` | `@nestjs/*`, `@prisma/*`, `axios`, `express`, `fs`, `net`, `http(s)` |

Se aplica **también a los tests y a los dobles**: es donde más presión hay para escribir
`as unknown as DiscountStrategy`, y es justo lo que `DE-R6.3` prohíbe para los stubs del tope.

`assertionStyle: 'never'` **no bloquea `as const`**: la regla exenta las const assertions, así
que `[...] as const satisfies readonly Product[]` —la forma que exige `SCS-R2.6`— pasa, mientras
`x as Shape` falla. Verificado con un fixture durante la implementación.

### Arnés

```ts
// packages/shared/vitest.config.ts
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    passWithNoTests: false,              // R3.3
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.types.ts', 'src/index.ts'],
      // thresholds: se añaden en DE-R6.1
    },
  },
});
```

`passWithNoTests: false` es la única guarda que funciona **durante** esta spec: mientras `src/`
esté vacío no hay nada que probar, y sin ella Vitest reportaría "aprobado" sobre cero pruebas. El
efecto es que `test:cov` falla al cerrar esta spec y empieza a pasar con la primera prueba de
`shared-contracts-seed`. Es correcto y está previsto.

## Design Decisions

**Los tres flags estrictos se declaran una sola vez.** Repetirlos por workspace funcionaría, pero
invita a la deriva: cuando alguien necesite bajar una restricción lo hará en su propio archivo y
nadie lo verá en la revisión. Declararlos solo en `tsconfig.base.json` convierte cualquier
relajación en un cambio visible sobre un archivo compartido.

**El régimen de tipado se separa del código que lo obedece.** El paquete no tiene lógica al
cerrar esta spec y aun así declara su `lint` y su `typecheck`. Son restricciones sobre todo lo
que escribirán las specs 2 y 3, y no pertenecen a ninguna en particular.

**El umbral de cobertura no vive aquí.** Se mide sobre módulos que todavía no existen;
declararlo produciría un umbral sobre un denominador vacío. Lo que sí vive aquí es
`passWithNoTests: false`, que cubre el caso degenerado.
