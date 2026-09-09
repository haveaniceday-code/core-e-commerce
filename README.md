# Core E-Commerce con Sistema de Descuentos Acumulativos

Monorepo full stack de un módulo de checkout: catálogo, carrito reactivo y un motor de descuentos
acumulativos con precedencia secuencial y tope absoluto del 35%.

El backend es la **única fuente de verdad del cálculo**: el cliente envía qué quiere comprar y con
qué cupón, nunca montos. El motor vive aislado en `packages/shared`, sin conocer NestJS, Prisma ni
HTTP, y lo consumen por igual la API y los tests.

## Requisitos

- **Node.js >= 20** (`engines` lo declara; la suite y el build lo asumen)
- **npm 10+** (se usan workspaces)

No hace falta Docker ni un motor de base de datos: la persistencia es SQLite en un archivo local.

## Estructura

```
apps/
├── backend/      API NestJS + Prisma/SQLite: valida stock, invoca el motor, persiste órdenes
└── frontend/     React + Vite + Zustand: carrito, cupón, desglose y confirmación
packages/
└── shared/       Contratos, seed canónico, utilidades de dinero y motor de descuentos
docs/
├── arquitectura.md   Decisiones, trade-offs y patrones aplicados
└── ia.md             Gobernanza de IA y bitácora de co-creación
```

`packages/shared` es dueño único del redondeo y del formateo de dinero. Ni el backend ni el frontend
redondean por su cuenta: es lo que garantiza que ambos muestren el mismo centavo.

## Puesta en marcha

Todos los comandos se ejecutan **desde la raíz** del repositorio.

```bash
# 1. Dependencias de los tres workspaces
npm install

# 2. @core/shared se consume por su dist desde el backend
npm run build --workspace packages/shared

# 3. Base de datos
cp apps/backend/.env.example apps/backend/.env
npm run db:generate --workspace apps/backend   # cliente Prisma
npm run db:migrate  --workspace apps/backend   # aplica la migración inicial
npm run db:seed     --workspace apps/backend   # siembra el catálogo
```

Después, **dos terminales**:

```bash
# terminal 1 — API en http://localhost:3000
npm run build --workspace apps/backend && npm run start --workspace apps/backend

# terminal 2 — UI en http://localhost:5173
npm run dev --workspace apps/frontend
```

El servidor de desarrollo de Vite redirige `/api` al backend, así que el navegador no emite
peticiones de origen cruzado y no hay CORS que configurar.

Tres puntos del orden no son negociables:

- `build` de `packages/shared` va **antes** de compilar el backend: allí `@core/shared` se resuelve
  por `dist/index.d.ts`. El frontend no lo necesita —su `tsconfig` y Vite apuntan a las fuentes del
  paquete—, y las suites tampoco.
- `db:generate` va antes de `build` y de `typecheck` del backend: los tipos de `@prisma/client` son
  generados.
- `build` del backend va antes de `start`, porque `start` es `node dist/main.js` y no compila.

### Volver al estado inicial

El seed hace `upsert` del catálogo, así que restaura el `stock` a sus valores canónicos:

```bash
npm run db:seed --workspace apps/backend
```

El arranque **no** siembra a propósito: si lo hiciera, cada reinicio borraría el stock decrementado
por las compras y no se podría demostrar que la persistencia es real.

## Variables de entorno

`apps/backend/.env.example` está versionado; `.env` no. El frontend no necesita ninguna.

| variable | dónde | valor por defecto | notas |
|----------|-------|-------------------|-------|
| `DATABASE_URL` | `apps/backend/.env` | `file:./prisma/dev.db` | Ruta relativa al directorio del schema. Requerida por Prisma |
| `PORT` | `apps/backend/.env` | `3000` | Se acepta un entero en `1..65535`; cualquier otro valor cae al default sin lanzar |

El archivo `.db` y sus auxiliares no se versionan: un clon limpio reconstruye la base con
`db:migrate` y `db:seed`.

## Comandos

Desde la raíz, alcanzan a los tres workspaces y propagan el fallo de cualquiera:

| comando | qué hace |
|---------|----------|
| `npm run typecheck` | `tsc` en los tres workspaces |
| `npm run lint` | ESLint con `--max-warnings 0` |
| `npm run test` | Todas las suites |
| `npm run test:cov` | Todas las suites **con el umbral del 80%**, que rompe el comando |
| `npm run build` | Compila los tres workspaces |

Para un workspace concreto, añade `--workspace <ruta>`, por ejemplo
`npm run test:cov --workspace apps/backend`.

## Pruebas y cobertura

```bash
npm run test:cov
```

Cada workspace mide su propia cobertura y tiene su propio `coverageThreshold` del **80% en líneas y
en ramas**, configurado para **salir con código distinto de `0`** cuando no se cumple. Medir no
basta: el comando tiene que fallar.

| workspace | runner | qué cubre | suites | tests | líneas | ramas |
|-----------|--------|-----------|--------|-------|--------|-------|
| `packages/shared` | Vitest | Motor, estrategias, factory, redondeo | 10 | 98 | 100% | 100% |
| `apps/backend` | Jest | Checkout, validación de stock, controllers | 12 | 268 | 88.93% | 91.42% |
| `apps/frontend` | Vitest + RTL | Estado del carrito, cupón, alerta del 35% | 4 | 166 | 100% | 100% |

El umbral está en cada workspace y no solo en el backend a propósito: el motor de descuentos vive en
`packages/shared`, y un umbral configurado únicamente en `apps/backend` no lo mediría.

Las suites corren **sin base de datos, sin servidor y sin variables de entorno adicionales**. Los
end-to-end del backend arrancan el módulo de Nest con supertest y sustituyen los adaptadores Prisma
por dobles en memoria; el frontend dobla su cliente HTTP.

Hay además una verificación manual de la migración y del seed contra una base temporal, documentada
en [`apps/backend/README.md`](apps/backend/README.md#verificación-manual-de-la-infraestructura).

## Recorrido de la aplicación

Con la API y la UI levantadas, en `http://localhost:5173`:

1. **Carrito** — agregar y quitar productos; el subtotal se actualiza al instante. Es la única
   aritmética de dinero del frontend: `precio × cantidad`, producto de enteros.
2. **Cupón y desglose** — aplicar `WELCOME2026` y ver las tres líneas de la cascada (categoría 10%,
   volumen 5%, cupón 15%), el porcentaje efectivo, el ahorro y el total a pagar. Un código no
   registrado o `SUMMER2024` (expirado) no es un error: la línea de cupón aparece como no aplicada.
3. **Alerta del tope** — aplicar `DEMOCAP50` y ver la notificación persistente del límite máximo de
   ahorro. Es el único camino de datos que activa el tope: con las tasas del enunciado el descuento
   máximo alcanzable es 27.325%, así que el tope es un invariante defensivo y no un paso de la
   cascada. El razonamiento está en [`docs/arquitectura.md`](docs/arquitectura.md).
4. **Stock insuficiente** — pedir más de 3 unidades de `PROD-005` y confirmar: el backend responde
   `409` con las líneas deficitarias y el carrito queda intacto.
5. **Persistencia** — completar una compra y comprobar que el catálogo recargado muestra el stock ya
   decrementado. Reiniciar el backend y verificar que sigue decrementado.

## Documentación

| documento | contenido |
|-----------|-----------|
| [`docs/arquitectura.md`](docs/arquitectura.md) | Elección de stack, capas, patrones aplicados, trade-offs y el aislamiento del motor |
| [`docs/ia.md`](docs/ia.md) | Skill y agente configurados, reparto de autoría y bitácora de correcciones a la IA |
| [`apps/backend/README.md`](apps/backend/README.md) | Detalle de scripts, entorno y verificación manual de la infraestructura |
| [`.kiro/specs/`](.kiro/specs/) | Las siete specs del desarrollo, cada una con requisitos, diseño y plan |

## Stack

TypeScript en todo el monorepo con `strict: true`, `noUncheckedIndexedAccess` y
`exactOptionalPropertyTypes`. Cero `any` y cero type assertions salvo `as const`, impuesto por
ESLint con `--max-warnings 0`.

| capa | tecnología |
|------|-----------|
| Backend | NestJS, Prisma, SQLite, class-validator |
| Frontend | React, Vite, Zustand |
| Compartido | TypeScript puro, sin dependencias de framework |
| Pruebas | Jest (backend), Vitest + React Testing Library (frontend y shared) |

La justificación de cada elección y sus trade-offs están en
[`docs/arquitectura.md`](docs/arquitectura.md).
