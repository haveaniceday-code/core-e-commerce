# @core/backend

API NestJS del checkout. En esta entrega expone el catálogo persistido en SQLite vía Prisma:

| método | ruta | propósito |
|--------|------|-----------|
| `GET` | `/api/products` | Catálogo con el stock actual, ordenado ascendentemente por `id` |

Las capas son `http` → `application` → `domain` → `infra`. El dominio no importa Prisma, NestJS ni
Express: el acceso a datos entra por la interfaz `ProductRepository` y el binding del token
`PRODUCT_REPOSITORY` a `PrismaProductRepository` vive en un único lugar (`src/http/products.module.ts`).
El motor de descuentos y los contratos se consumen desde `@core/shared` por su entry público.

## Puesta en marcha

Todos los comandos se ejecutan desde la raíz del monorepo.

```bash
npm install                                    # raíz: instala los tres workspaces
npm run build --workspace packages/shared      # @core/shared se consume por su dist
cp apps/backend/.env.example apps/backend/.env
npm run db:generate --workspace apps/backend   # prisma generate
npm run db:migrate  --workspace apps/backend   # prisma migrate deploy
npm run db:seed     --workspace apps/backend   # prisma db seed
npm run build       --workspace apps/backend   # tsc -p tsconfig.build.json → dist/
npm run start       --workspace apps/backend   # node dist/main.js
```

El orden no es negociable en tres puntos:

- `build` de `packages/shared` va antes que cualquier compilación del backend: `@core/shared` se
  resuelve por `dist/index.d.ts`. (La suite de Jest no lo necesita: su `moduleNameMapper` apunta al
  `index.ts` del paquete.)
- `db:generate` va antes de `build` y de `typecheck`: los tipos de `@prisma/client` son generados.
- `build` del backend va antes de `start`, porque `start` es `node dist/main.js` y no compila.

### Variables de entorno

`.env.example` está versionado; `.env` no. `DATABASE_URL` es una ruta relativa al directorio del
schema, así que `file:./prisma/dev.db` produce `apps/backend/prisma/dev.db`.

| variable | valor por defecto | notas |
|----------|-------------------|-------|
| `DATABASE_URL` | `file:./prisma/dev.db` | Requerida por Prisma. Sin ella, `db:migrate` y `db:seed` fallan |
| `PORT` | `3000` | `resolvePort` acepta un entero en `1..65535`; cualquier otro valor cae al default sin lanzar |

El archivo `.db` y sus auxiliares (`.db-journal`, `.db-wal`, `.db-shm`) no se versionan: un clon
limpio reconstruye la base con `db:migrate` y `db:seed`.

## Scripts

| script | comando | qué hace |
|--------|---------|----------|
| `build` | `tsc -p tsconfig.build.json` | Emite `dist/` desde `src/`, sin specs ni `test/` |
| `start` | `node dist/main.js` | Arranca la app ya compilada. Prefijo global `/api`, `ValidationPipe` y `ApiExceptionFilter` globales |
| `typecheck` | `tsc --noEmit` | Verifica el proyecto por defecto (`tsconfig.json`): `src/`, `test/`, `prisma/` y `jest.config.ts` |
| `lint` | `eslint src test --max-warnings 0` | Incluye la regla que prohíbe a `src/domain/**` importar Prisma, NestJS, Express, `infra/` o `http/` |
| `test` | `jest` | Unitarias y end-to-end, sin base de datos |
| `test:cov` | `jest --coverage` | Igual, con el umbral del 80% |
| `db:generate` | `prisma generate` | Cliente Prisma en `node_modules/.prisma` |
| `db:migrate` | `prisma migrate deploy` | Aplica las migraciones versionadas. No genera migraciones nuevas |
| `db:seed` | `prisma db seed` | Ejecuta `prisma/seed.ts` con `ts-node` |

Dos proyectos de TypeScript, con responsabilidades separadas: `tsconfig.json` es el de
**verificación** (`noEmit`, incluye `src/`, `test/` y `prisma/`, porque los specs de `src/` importan
dobles de `test/`), y `tsconfig.build.json` es el único que **emite**, con `rootDir` estrechado a
`src/`.

El arranque no migra y no siembra: solo conecta. El seed reescribe el `stock` al valor canónico del
catálogo, y por eso es un comando explícito y no un efecto del `start`; si lo ejecutara el arranque,
cada reinicio borraría el stock decrementado por las compras.

## Pruebas

```bash
npm run test     --workspace apps/backend
npm run test:cov --workspace apps/backend
```

La suite corre **sin base de datos, sin servidor y sin variables de entorno adicionales**. El
end-to-end de `GET /api/products` arranca el módulo de Nest con supertest y sustituye
`PRODUCT_REPOSITORY` por `InMemoryProductRepository`, de modo que el adaptador Prisma nunca se
ejecuta. Los dobles están tipados por completo: sin `any`, sin assertions, sin `@ts-ignore`.

`coverageThreshold` está en 80% de líneas y de ramas, y `test:cov` sale con código distinto de `0`
cuando cualquiera de los dos queda por debajo. Quedan fuera de la medición el bootstrap
(`src/main.ts`), el provider Prisma (`prisma.service.ts`) y el adaptador
(`prisma-product.repository.ts`): la lógica de lectura no vive en el adaptador sino en
`src/domain/product-mapper.ts`, que sí se mide.

`npm run test` y `npm run test:cov` de la raíz alcanzan este workspace y propagan su fallo.

## Verificación manual de la infraestructura

Que la migración versionada deje el esquema completo y que el seed sea idempotente **no** se
verifica en Jest: la suite corre sin base de datos por diseño. Se comprueba a mano sobre un archivo
temporal, sin tocar `prisma/dev.db`:

```bash
TMPDB="$(mktemp -d)/verify.db"
DATABASE_URL="file:$TMPDB" npm run db:migrate --workspace apps/backend
DATABASE_URL="file:$TMPDB" npm run db:seed    --workspace apps/backend
DATABASE_URL="file:$TMPDB" npm run db:seed    --workspace apps/backend   # idempotencia
rm -rf "$(dirname "$TMPDB")"
```

`DATABASE_URL` del entorno tiene precedencia sobre el `.env`, así que la ruta temporal gana sin
editar ningún archivo. Qué debe verse:

- `db:migrate` crea la base vacía y aplica `20260909104844_init` con las tres tablas (`Product`,
  `Order`, `OrderItem`).
- cada `db:seed` imprime `Seed completado: 6 productos escritos.` y sale con `0`. La segunda
  ejecución deja las mismas seis filas, porque el seed hace `upsert` por `id`.
- un fallo de conexión o de escritura se describe por `stderr` y el proceso sale con código distinto
  de `0`.

La idempotencia de `seedProducts` sí está cubierta por Jest (`test/seed.spec.ts`), contra un almacén
doble tipado. Lo que esta verificación añade es el tramo que el doble no puede cubrir: el SQL
versionado y el cliente Prisma real.
