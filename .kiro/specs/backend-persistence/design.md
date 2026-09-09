# Design Document

## Overview

`apps/backend` entra al monorepo como una aplicación NestJS de cuatro capas —`http` → `application`
→ `domain` → `infra`— con persistencia Prisma sobre SQLite. Esta entrega instala el arranque, el
schema con su migración inicial, el seed explícito del catálogo, las interfaces de repositorio y un
único endpoint de lectura: `GET /api/products`.

El diseño está gobernado por una idea: **el dominio del backend no conoce Prisma, ni NestJS, ni
HTTP**. Esa restricción no es estética, es lo que permite que el mapeo de fila a `Product` —la única
lógica no trivial de esta entrega— viva en una función pura, se pruebe con dobles en memoria y deje
al adaptador Prisma reducido a una consulta y una delegación. Por eso el adaptador se puede excluir
de la medición de cobertura (R6.6) sin dejar lógica sin probar: no hay lógica dentro.

Lenguaje: TypeScript con `strict: true` heredado de `tsconfig.base.json`, que además activa
`noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`. Cero `any`, cero assertions salvo
`as const` y `satisfies`.

### Decisiones de alcance ya cerradas

Estas decisiones vienen de la clarificación y el diseño las respeta sin reabrirlas:

| # | Decisión |
|---|----------|
| D1 | `OrderRepository` entra como interfaz de dominio y como modelos `Order`/`OrderItem` en el schema y la migración inicial. **No hay adaptador Prisma de órdenes** en esta entrega. |
| D2 | El seed es un script explícito, registrado como `prisma db seed` y expuesto como `npm run db:seed`. Hace upsert de `CATALOG_PRODUCTS` desde `@core/shared`. **El arranque no siembra.** |
| D3 | Los cupones se resuelven en memoria desde `@core/shared`. No hay modelo `Coupon` ni `CouponRepository`. |
| D4 | Pruebas: unitarios **por ejemplo** con dobles en memoria tipados, más un e2e de `GET /api/products` con supertest. Jest con `coverageThreshold` del 80% en líneas y ramas que rompe el comando. Quedan fuera de la medición el adaptador Prisma, el provider Prisma y el bootstrap; `seedProducts` sí se mide. |

### Decisión de diseño que sí abre este documento: el código de error del 500

`R5.7` exige responder `500` con un cuerpo que respete la forma `ApiError`, y `ApiError.error.code`
está tipado como `ErrorCode`, cuya unión canónica tiene tres miembros: `INSUFFICIENT_STOCK` (409),
`PRODUCT_NOT_FOUND` (404) e `INVALID_CART` (400). **Ninguno describe un fallo interno del servidor.**

Emitir `INVALID_CART` en un `500` sería mentirle al cliente y al log: el frontend podría tratar como
error de entrada lo que es una caída de infraestructura, y el operador buscaría un carrito que no
existe. Silenciar el problema con una assertion está prohibido.

Decisión: **se añade `'INTERNAL_ERROR'` a `ERROR_CODES` en `packages/shared/src/domain/errors.ts`**,
mapeado a `500`, marcado en el código como extensión de infraestructura ajena al enunciado —del
mismo modo que `DEMOCAP50` está marcado como extensión de demo— y documentado en
`docs/arquitectura.md`. Es un cambio aditivo de una línea sobre el dueño único del contrato de
error, que mantiene una sola fuente de verdad y permite que la unión siga siendo exhaustiva en el
`Record<ErrorCode, number>` del filtro. La alternativa (una unión local del backend) rompería la
regla de que las respuestas de la API usan contratos importados de `packages/shared`.

## Architecture

```
HTTP  ──► http/            ProductsController, ApiExceptionFilter
                           orquesta: recibe, delega, responde. Cero reglas.
             │
             ▼
          application/     CatalogService
                           caso de uso: pide el catálogo al repositorio.
             │
             ▼ (token de inyección, no clase concreta)
          domain/          ProductRepository, OrderRepository,
                           toProduct (mapeo puro), compareProductId,
                           CorruptProductRowError, tokens
                           sin Prisma, sin NestJS, sin HTTP.
             ▲
             │ implements
          infra/prisma/    PrismaService (PrismaClient con ciclo de vida),
                           PrismaProductRepository (query + delegación)
```

La flecha que importa es la última: `application` depende de la **interfaz** de dominio resuelta por
token, y `infra` es quien depende del dominio. Invertir esa dependencia es lo que hace que un test
sustituya la persistencia con `overrideProvider(PRODUCT_REPOSITORY)` sin tocar el servicio (R4.4).

### Estructura de carpetas

```
apps/backend/
├── .env.example                       # DATABASE_URL y PORT de referencia (versionado)
├── eslint.config.mjs
├── jest.config.ts
├── package.json
├── tsconfig.json                      # extiende ../../tsconfig.base.json
├── tsconfig.build.json                # excluye *.spec.ts y test/
├── README.md                          # secuencia de puesta en marcha (R2.8)
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                        # Script_Seed (R3)
│   └── migrations/
│       ├── migration_lock.toml
│       └── 20260101000000_init/
│           └── migration.sql
├── src/
│   ├── main.ts                        # bootstrap: prefijo /api, ValidationPipe, PORT
│   ├── port.ts                        # resolvePort: función pura, testeable
│   ├── port.spec.ts
│   ├── app.module.ts                  # raíz: importa PrismaModule y ProductsModule
│   ├── domain/
│   │   ├── tokens.ts                  # PRODUCT_REPOSITORY, ORDER_REPOSITORY
│   │   ├── product.repository.ts      # interfaz + contrato de orden
│   │   ├── order.repository.ts        # interfaz sin implementación (D1)
│   │   ├── product-mapper.ts          # PersistedProductRow, isProductCategory, toProduct
│   │   ├── product-order.ts           # compareProductId
│   │   ├── errors.ts                  # CorruptProductRowError
│   │   ├── product-mapper.spec.ts
│   │   └── product-order.spec.ts
│   ├── application/
│   │   ├── catalog.service.ts
│   │   └── catalog.service.spec.ts
│   ├── http/
│   │   ├── products.controller.ts
│   │   ├── products.controller.spec.ts
│   │   ├── products.module.ts
│   │   ├── api-exception.filter.ts
│   │   └── api-exception.filter.spec.ts
│   └── infra/
│       └── prisma/
│           ├── prisma.service.ts            # excluido de cobertura
│           ├── prisma.module.ts
│           └── prisma-product.repository.ts # excluido de cobertura
└── test/
    ├── doubles/in-memory-product.repository.ts
    ├── seed.spec.ts                            # idempotencia de seedProducts
    └── products.e2e-spec.ts
```

`port.ts` está fuera de `main.ts` a propósito: `main.ts` queda excluido de cobertura por ser
bootstrap, y la resolución del puerto sí tiene ramas que merecen prueba.

`product-mapper.ts` vive en `domain` y no en `infra` por la misma razón: recibe una fila
**estructural** (`PersistedProductRow`), no un tipo de Prisma, así que no arrastra dependencias y
queda dentro de la medición de cobertura.

`test/seed.spec.ts` vive bajo `test/` y no junto a `prisma/seed.ts` porque los `roots` de Jest son
`src` y `test`: un spec dentro de `prisma/` no lo recogería el runner.

La pureza del dominio (R4.3) **no se prueba en runtime**: se impone en `eslint.config.mjs` con una
regla acotada al directorio, que falla antes y más barato que un test que recorra imports.

```js
// eslint.config.mjs — bloque adicional
{
  files: ['src/domain/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['@prisma/client', '@nestjs/*', 'express'], message: 'El dominio no conoce el framework ni la persistencia (R4.3).' },
        { group: ['**/infra/**', '**/http/**'], message: 'El dominio no depende de sus adaptadores (R4.3).' },
      ],
    }],
  },
}
```

## Components and Interfaces

### Dominio: tokens de inyección

```ts
// src/domain/tokens.ts
/**
 * Tokens de inyección como literales `as const`. No importan NestJS: el dominio
 * declara el nombre del puerto, el módulo de infraestructura decide con qué lo llena.
 */
export const PRODUCT_REPOSITORY = 'domain.ProductRepository' as const;
export const ORDER_REPOSITORY = 'domain.OrderRepository' as const;
```

Se usan strings prefijados en lugar de símbolos porque los símbolos no sobreviven a un
`import type` accidental y el prefijo evita colisiones en el contenedor.

### Dominio: interfaces de repositorio

```ts
// src/domain/product.repository.ts
import type { Product } from '@core/shared';

export interface ProductRepository {
  /**
   * Catálogo completo, SIEMPRE en orden ascendente por `id` (BP-R5.5).
   * El orden es parte del contrato, no un detalle del adaptador: si viviera solo
   * en el `orderBy` de Prisma, un doble de prueba podría devolver otro orden y el
   * e2e pasaría afirmando algo que producción no garantiza.
   */
  findAll(): Promise<readonly Product[]>;

  /** Ausencia tipada, sin excepción (BP-R4.6). */
  findById(id: string): Promise<Product | undefined>;
}
```

```ts
// src/domain/order.repository.ts
import type { ProductCategory } from '@core/shared';

/** Línea de orden ya resuelta, con todos los montos en centavos enteros. */
export interface NewOrderLine {
  readonly productId: string;
  readonly category: ProductCategory;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly lineTotalCents: number;
}

export interface NewOrder {
  readonly originalSubtotalCents: number;
  readonly totalSavingsCents: number;
  readonly finalTotalCents: number;
  readonly capApplied: boolean;
  readonly couponCode?: string;
  readonly lines: readonly NewOrderLine[];
}

export interface PersistedOrder extends NewOrder {
  readonly id: string;
  readonly createdAt: Date;
}

/**
 * Interfaz declarada, sin implementación concreta en esta entrega (D1 / BP-R4.2).
 * Su único consumidor hoy es un doble en memoria en `test/doubles`, que existe para
 * que el compilador verifique que la interfaz es implementable.
 */
export interface OrderRepository {
  create(order: NewOrder): Promise<PersistedOrder>;
}
```

### Dominio: mapeo runtime de `category` sin assertions

Este es el núcleo de la entrega. La fila persistida trae `category: string`; el contrato exige
`ProductCategory`. El estrechamiento se hace con un type guard sobre `PRODUCT_CATEGORIES`, no con
`as`.

```ts
// src/domain/product-mapper.ts
import { PRODUCT_CATEGORIES } from '@core/shared';
import { CorruptProductRowError } from './errors';
import type { Product, ProductCategory } from '@core/shared';

/**
 * Forma estructural de una fila persistida. Deliberadamente NO es un tipo de Prisma:
 * el modelo generado la satisface estructuralmente, así que el adaptador puede pasarla
 * sin conversión, y el dominio no importa `@prisma/client` (BP-R4.3).
 */
export interface PersistedProductRow {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly priceCents: number;
  readonly stock: number;
}

/**
 * `.some(...)` y no `.includes(...)`: `includes` sobre un `readonly ProductCategory[]`
 * exige un argumento ya estrechado, lo que obligaría a una assertion. La comparación
 * `===` entre el literal y el `string` es legal y el predicado hace el narrowing.
 */
export const isProductCategory = (value: string): value is ProductCategory =>
  PRODUCT_CATEGORIES.some((category) => category === value);

/**
 * Mapea fila -> Product enumerando las cinco claves una por una. No usa spread:
 * un `...row` propagaría cualquier columna futura al JSON de la API y rompería
 * BP-R5.3 en silencio.
 */
export const toProduct = (row: PersistedProductRow): Product => {
  if (!isProductCategory(row.category)) {
    throw new CorruptProductRowError(row.id, row.category);
  }
  return {
    id: row.id,
    name: row.name,
    category: row.category, // ya estrechado por el guard
    priceCents: row.priceCents,
    stock: row.stock,
  };
};
```

```ts
// src/domain/errors.ts
import { PRODUCT_CATEGORIES } from '@core/shared';

/**
 * Dato persistido corrupto (BP-R4.7). Identifica el `id` y el valor inválido para que
 * el fallo sea diagnosticable; el filtro lo traduce a un 500 genérico y jamás propaga
 * estos datos al cliente.
 *
 * No hereda de `DiscountDomainError` porque no es un error de dominio del cálculo:
 * es una violación de integridad del almacén.
 */
export class CorruptProductRowError extends Error {
  constructor(
    readonly productId: string,
    readonly invalidCategory: string,
  ) {
    super(
      `La fila ${productId} tiene la categoria "${invalidCategory}", ajena a ${PRODUCT_CATEGORIES.join(' | ')}.`,
    );
    this.name = 'CorruptProductRowError';
  }
}

export const isCorruptProductRowError = (value: unknown): value is CorruptProductRowError =>
  value instanceof CorruptProductRowError;
```

El caso que este error captura es exactamente el fallo silencioso que advierte el steering: una fila
con `Tecnología` (con tilde) no es `Tecnologia`. Sin la comprobación, el producto entraría al sistema
con una categoría que ninguna regla reconoce y el descuento simplemente no se aplicaría.

### Dominio: orden determinista

```ts
// src/domain/product-order.ts
import type { Product } from '@core/shared';

/** Comparador único del orden del catálogo. Los ids son ASCII, así que `localeCompare`
 *  sería innecesario y además dependiente del locale del proceso. */
export const compareProductId = (a: Product, b: Product): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export const sortByProductId = (products: readonly Product[]): readonly Product[] =>
  [...products].sort(compareProductId);
```

El adaptador Prisma delega el orden a `orderBy: { id: 'asc' }`; el doble en memoria usa
`sortByProductId`. Ambos honran el mismo contrato y el comparador queda cubierto por tests.

### Aplicación: `CatalogService`

```ts
// src/application/catalog.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { PRODUCT_REPOSITORY } from '../domain/tokens';
import type { ProductRepository } from '../domain/product.repository';
import type { Product } from '@core/shared';

@Injectable()
export class CatalogService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
  ) {}

  /** Sin filtros, sin transformaciones: el catálogo tal cual lo entrega el puerto (BP-R5.2). */
  listCatalog(): Promise<readonly Product[]> {
    return this.products.findAll();
  }
}
```

### HTTP: controlador

```ts
// src/http/products.controller.ts
import { Controller, Get } from '@nestjs/common';
import { CatalogService } from '../application/catalog.service';
import type { Product } from '@core/shared';

@Controller('products') // con el prefijo global => GET /api/products
export class ProductsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  getProducts(): Promise<readonly Product[]> {
    return this.catalog.listCatalog();
  }
}
```

Una línea de cuerpo, una sola llamada, sin `try/catch`: la traducción del fallo es responsabilidad
del filtro (R5.1, R5.7).

### HTTP: filtro de excepciones y forma `ApiError`

```ts
// src/http/api-exception.filter.ts
import { Catch, HttpException, Logger } from '@nestjs/common';
import { isDiscountDomainError } from '@core/shared';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError, ErrorCode } from '@core/shared';

/** Exhaustivo por construcción: añadir un ErrorCode sin estado rompe la compilación. */
const STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  INSUFFICIENT_STOCK: 409,
  PRODUCT_NOT_FOUND: 404,
  INVALID_CART: 400,
  INTERNAL_ERROR: 500,
};

const GENERIC_MESSAGE = 'Error interno del servidor.';

const internalError = (): ApiError => ({
  error: { code: 'INTERNAL_ERROR', message: GENERIC_MESSAGE },
});

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    // Errores de dominio: el código viaja tal cual y el estado sale de la tabla.
    if (isDiscountDomainError(exception)) {
      response.status(STATUS_BY_ERROR_CODE[exception.code]).json(exception.toApiError());
      return;
    }

    // HttpException de Nest (404 de ruta inexistente, 400 del ValidationPipe):
    // conserva su estado y su cuerpo. BP-R6.4 afirma el estado, no el cuerpo.
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    // Todo lo demás —fallo del repositorio, fila corrupta, caída de SQLite— se
    // registra completo del lado servidor y sale al cliente como cuerpo genérico:
    // ni el mensaje original, ni la consulta, ni la ruta del .db, ni la traza.
    this.logger.error('Fallo no controlado', exception);
    response.status(500).json(internalError());
  }
}
```

El saneamiento es por construcción: el cuerpo del 500 es una constante, no una derivación del error.
No hay camino por el que un mensaje interno llegue al cliente.

### Infraestructura: provider del cliente Prisma

```ts
// src/infra/prisma/prisma.service.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Único punto del backend que instancia PrismaClient (BP-R2.6).
 * No siembra, no migra, no restaura stock: solo conecta y desconecta (BP-R3.6).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

```ts
// src/infra/prisma/prisma-product.repository.ts
import { Injectable } from '@nestjs/common';
import { toProduct } from '../../domain/product-mapper';
import { PrismaService } from './prisma.service';
import type { ProductRepository } from '../../domain/product.repository';
import type { Product } from '@core/shared';

@Injectable()
export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<readonly Product[]> {
    const rows = await this.prisma.product.findMany({ orderBy: { id: 'asc' } });
    return rows.map(toProduct); // la fila de Prisma satisface PersistedProductRow
  }

  async findById(id: string): Promise<Product | undefined> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    return row === null ? undefined : toProduct(row);
  }
}
```

`null` de Prisma se convierte a `undefined` aquí y no más arriba: el dominio expresa ausencia con
`undefined`, igual que `findProductById` de `@core/shared`.

### Módulos

```ts
// src/infra/prisma/prisma.module.ts
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}

// src/http/products.module.ts
@Module({
  imports: [PrismaModule],
  controllers: [ProductsController],
  providers: [
    CatalogService,
    { provide: PRODUCT_REPOSITORY, useClass: PrismaProductRepository },
  ],
})
export class ProductsModule {}

// src/app.module.ts
@Module({ imports: [PrismaModule, ProductsModule] })
export class AppModule {}
```

El binding `PRODUCT_REPOSITORY → PrismaProductRepository` está en un solo lugar. Si el token no
estuviera provisto, el contenedor de Nest falla al compilar el módulo señalando el token: es
comportamiento garantizado por el framework y no se prueba en esta suite.

### Bootstrap

```ts
// src/port.ts
export const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;

/**
 * Total por construcción: cualquier entrada que no sea un entero de puerto válido
 * cae en DEFAULT_PORT (BP-R1.3). `Number('')` es 0 y `Number('3000.5')` no es entero:
 * ambos caen al default sin rama especial.
 */
export const resolvePort = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_PORT;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_PORT ? parsed : DEFAULT_PORT;
};
```

```ts
// src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { resolvePort } from './port';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(resolvePort(process.env.PORT));
};

void bootstrap();
```

El `ValidationPipe` se registra ya en esta entrega aunque todavía no haya DTO de entrada: es la
costura que `POST /api/checkout` consume sin reconfigurar nada (R1.2).

### Script de seed

```ts
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { CATALOG_PRODUCTS } from '@core/shared';
import type { Product } from '@core/shared';

/**
 * Upsert por id: idempotente por definición (BP-R3.2). `update` reescribe también el
 * stock, que es lo correcto para un seed —restablece el catálogo canónico— y es
 * justamente por eso que el arranque NO lo ejecuta (D2 / BP-R3.6).
 */
export const seedProducts = async (
  client: Pick<PrismaClient, 'product'>,
  products: readonly Product[] = CATALOG_PRODUCTS,
): Promise<number> => {
  for (const p of products) {
    const data = {
      name: p.name,
      category: p.category,
      priceCents: p.priceCents,
      stock: p.stock,
    };
    await client.product.upsert({
      where: { id: p.id },
      create: { id: p.id, ...data },
      update: data,
    });
  }
  return products.length;
};

const main = async (): Promise<void> => {
  const client = new PrismaClient();
  try {
    const written = await seedProducts(client);
    console.log(`Seed completado: ${String(written)} productos escritos.`);
  } finally {
    await client.$disconnect();
  }
};

void main().catch((error: unknown) => {
  console.error('Seed fallido:', error);
  process.exitCode = 1;
});
```

`seedProducts` recibe el cliente como parámetro tipado con `Pick<PrismaClient, 'product'>`: es lo
que permite probar la idempotencia contra un almacén doble sin base de datos (R3.2, R6.1), mientras
`main` —el único código con efectos de proceso— queda fuera de cobertura.

`upsert` no reordena filas ni depende del estado previo, así que el resultado tras `n ≥ 1`
ejecuciones es el mismo: seis filas, mismas claves, sin duplicados.

## Data Models

### Schema Prisma

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

/// Espejo persistido del contrato `Product` de @core/shared.
/// `category` es String y no un enum de Prisma: el enum no está soportado en SQLite,
/// y el estrechamiento a ProductCategory se hace en runtime en `toProduct` (BP-R4.5).
model Product {
  id         String @id
  name       String
  category   String
  priceCents Int
  stock      Int

  orderItems OrderItem[]
}

/// Declarado para la parte 2. Sin adaptador en esta entrega (D1 / BP-R2.3).
/// Todos los montos en centavos enteros; nunca Float, nunca Decimal.
model Order {
  id                    String   @id @default(uuid())
  originalSubtotalCents Int
  totalSavingsCents     Int
  finalTotalCents       Int
  capApplied            Boolean
  couponCode            String?
  createdAt             DateTime @default(now())

  items OrderItem[]
}

model OrderItem {
  id             String @id @default(uuid())
  orderId        String
  productId      String
  quantity       Int
  unitPriceCents Int
  lineTotalCents Int

  order   Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product Product @relation(fields: [productId], references: [id])

  @@index([orderId])
  @@index([productId])
}

// Sin modelo Coupon: los cupones se resuelven en memoria desde @core/shared (D3 / BP-R2.4).
```

`unitPriceCents` se guarda en la línea porque el precio del catálogo puede cambiar después de la
compra y la orden debe conservar el precio al que se vendió. `lineTotalCents` es derivable, pero se
persiste para que la orden sea auditable sin recalcular.

### Migración inicial

`prisma/migrations/20260101000000_init/migration.sql` contiene los tres `CREATE TABLE` —`Product`,
`Order`, `OrderItem`— con sus claves foráneas e índices, generados por
`prisma migrate dev --name init`. Se versiona junto a `migration_lock.toml`, de modo que
`prisma migrate deploy` sobre una base vacía deja el esquema completo (R2.5).

### Configuración de entorno

`.env.example` (versionado):

```
DATABASE_URL="file:./prisma/dev.db"
PORT=3000
```

`.gitignore` de la raíz ya cubre `node_modules`, `dist`, `coverage`, `*.db`, `*.db-journal` y `.env`.
Esta entrega añade `*.db-wal` y `*.db-shm` (archivos de SQLite en modo WAL). El cliente generado vive
en `node_modules/.prisma`, ya ignorado (R2.7).

### Secuencia de puesta en marcha (R2.8)

```bash
npm install                                    # raíz
npm run build --workspace packages/shared      # @core/shared consumido por dist
cp apps/backend/.env.example apps/backend/.env
npm run db:generate --workspace apps/backend   # prisma generate
npm run db:migrate  --workspace apps/backend   # prisma migrate deploy
npm run db:seed     --workspace apps/backend   # prisma db seed
npm run start       --workspace apps/backend
```

### `package.json` de `apps/backend`

```json
{
  "name": "@core/backend",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src test --max-warnings 0",
    "test": "jest",
    "test:cov": "jest --coverage",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate deploy",
    "db:seed": "prisma db seed"
  },
  "prisma": {
    "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"
  },
  "dependencies": {
    "@core/shared": "1.0.0",
    "@nestjs/common": "10.4.15",
    "@nestjs/core": "10.4.15",
    "@nestjs/platform-express": "10.4.15",
    "@prisma/client": "5.22.0",
    "class-transformer": "0.5.1",
    "class-validator": "0.14.1",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "10.4.15",
    "@types/express": "4.17.21",
    "@types/jest": "29.5.14",
    "@types/node": "20.17.10",
    "@types/supertest": "6.0.2",
    "jest": "29.7.0",
    "prisma": "5.22.0",
    "supertest": "7.0.0",
    "ts-jest": "29.2.5",
    "ts-node": "10.9.2"
  }
}
```

Versiones exactas, sin rangos: una actualización de Nest o Prisma es una decisión deliberada, no un
efecto de `npm install`. `db:seed` invoca `prisma db seed`, que ejecuta el mismo `prisma/seed.ts` que
registra el bloque `prisma`, de modo que ambos caminos corren un único código (R3.3).

`tsconfig.json` del backend extiende `tsconfig.base.json` y añade lo que NestJS necesita:
`"experimentalDecorators": true`, `"emitDecoratorMetadata": true`, `"rootDir": "./src"`,
`"outDir": "./dist"`, `"types": ["node", "jest"]`.

## Error Handling

| Origen | Excepción | Estado | Cuerpo |
|--------|-----------|--------|--------|
| Fallo del repositorio / SQLite caído | error desconocido | `500` | `ApiError` con `INTERNAL_ERROR` y mensaje genérico |
| Fila con `category` fuera de `PRODUCT_CATEGORIES` | `CorruptProductRowError` | `500` | igual que arriba; el `id` y el valor inválido solo al log |
| Ruta sin el prefijo `/api` | `NotFoundException` de Nest | `404` | cuerpo por defecto de Nest |
| Errores del cálculo (parte 2) | `DiscountDomainError` | `409` / `404` / `400` según `code` | `exception.toApiError()` |
| Seed que falla al conectar o escribir | error propagado | — | `process.exitCode = 1` y descripción por `stderr` (R3.5) |

Tres reglas que el diseño mantiene:

1. **El cliente nunca ve detalles internos.** El cuerpo del 500 es una constante.
2. **El log sí los ve todos.** `logger.error` recibe la excepción completa.
3. **Ausencia no es error.** `findById` sin fila devuelve `undefined`; catálogo vacío responde `200`
   con `[]`. Solo la corrupción de datos y el fallo de infraestructura son excepciones.

## Testing Strategy

**Jest en `apps/backend`** (`jest.config.ts`):

```ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '\\.(spec|e2e-spec)\\.ts$',
  moduleNameMapper: {
    // Sigue siendo el entry público: apunta al index.ts, no a rutas internas.
    // Evita depender de un build previo de packages/shared para correr la suite.
    '^@core/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  collectCoverageFrom: ['src/**/*.ts', 'prisma/seed.ts'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/main.ts',                                  // bootstrap
    '<rootDir>/src/infra/prisma/prisma.service.ts',            // provider Prisma
    '<rootDir>/src/infra/prisma/prisma-product.repository.ts', // adaptador Prisma
    '\\.spec\\.ts$',
  ],
  coverageThreshold: { global: { lines: 80, branches: 80 } },
};

export default config;
```

`prisma/seed.ts` aparece en `collectCoverageFrom` pero su `main` no se ejecuta en tests; la parte
probada es `seedProducts`, con la prueba de idempotencia de `test/seed.spec.ts`. Si esa combinación
arrastrara el porcentaje por debajo del umbral, la alternativa es excluir el archivo completo antes
que relajar el 80%.
El umbral rompe el comando: `jest --coverage` sale con código distinto de `0` cuando líneas o ramas
caen por debajo (R6.5), y `npm run test:cov` de la raíz lo propaga (R6.7).

**Dobles tipados, sin `any` ni assertions** (R6.2):

```ts
// test/doubles/in-memory-product.repository.ts
export class InMemoryProductRepository implements ProductRepository {
  public findAllCalls = 0;
  constructor(private readonly rows: readonly Product[] = CATALOG_PRODUCTS) {}

  findAll(): Promise<readonly Product[]> {
    this.findAllCalls += 1;
    return Promise.resolve(sortByProductId(this.rows)); // honra el contrato de orden
  }

  findById(id: string): Promise<Product | undefined> {
    return Promise.resolve(this.rows.find((p) => p.id === id));
  }
}

/** Doble que falla, para R5.7. */
export class FailingProductRepository implements ProductRepository {
  constructor(private readonly error: Error) {}
  findAll(): Promise<readonly Product[]> { return Promise.reject(this.error); }
  findById(): Promise<Product | undefined> { return Promise.reject(this.error); }
}
```

**Reparto del esfuerzo:**

**Todo es prueba por ejemplo.** No se usa testing basado en propiedades: `packages/shared` —donde
vive la cascada multiplicativa, los micro-centavos y el invariante del tope— alcanzó el 100% con
tests por ejemplo y sin `fast-check`. Introducir esa maquinaria aquí, sobre la pieza con menos
lógica del proyecto, invertiría el esfuerzo y sería incoherente con la spec del motor.

Las únicas piezas de esta entrega con ramas son cuatro, y cada una lleva su tabla de casos fijos:

| pieza | archivo | casos |
|-------|---------|-------|
| `resolvePort` | `src/port.spec.ts` | `undefined`, `''`, `'abc'`, `'3.5'`, `'-1'`, `'0'`, `'70000'` → `3000`; `'8080'` → `8080` |
| `toProduct` | `src/domain/product-mapper.spec.ts` | una fila válida por categoría (`Tecnologia`, `Hogar`, `Ropa`); una fila con columna extra que no debe propagarse; y las corruptas `'Tecnología'` con tilde, `'TECNOLOGIA'` y `''` → `CorruptProductRowError` con `productId` e `invalidCategory` |
| `sortByProductId` | `src/domain/product-order.spec.ts` | catálogo vacío, un solo producto, entrada desordenada, y verificación de que no muta el arreglo recibido |
| `ApiExceptionFilter` | `src/http/api-exception.filter.spec.ts` | `DiscountDomainError` por cada `ErrorCode` → su estado y `toApiError()`; `HttpException` de Nest → su estado; error con `'/prisma/dev.db'` y SQL en el mensaje → `500` con cuerpo constante que **no** contiene esas subcadenas |

Resto de unitarios: `CatalogService` con catálogo sembrado, catálogo vacío y fallo del repositorio
(R6.3), afirmando una única llamada a `findAll`; `ProductsController` delegando sin transformar; y
`seedProducts` ejecutado dos veces seguidas sobre un almacén doble tipado, partiendo de vacío y de
un stock decrementado, afirmando que las filas resultantes son exactamente `CATALOG_PRODUCTS`.

**Más allá de los unitarios:**

- *e2e (`test/products.e2e-spec.ts`):* `Test.createTestingModule({ imports: [ProductsModule] })` con
  `.overrideProvider(PRODUCT_REPOSITORY).useValue(new InMemoryProductRepository())`,
  `setGlobalPrefix('api')` y `useGlobalFilters(new ApiExceptionFilter())`; supertest afirma
  `GET /api/products` → `200` con el catálogo, y `GET /products` → `404` (R6.4). Sin base de datos:
  el adaptador Prisma se sustituye por el doble.
- *Integración de infraestructura (manual, documentada en el README):* `migrate deploy` + `db:seed`
  sobre un archivo temporal para verificar R2.5 y R3.4. No entra en la suite de Jest porque R6.1
  exige que las pruebas corran sin base de datos.

## Invariantes verificadas

Cada invariante de esta entrega se verifica con la tabla de casos fijos de la sección anterior, no
con generación aleatoria. Se listan para que la trazabilidad requisito → prueba quede explícita.

| # | Invariante | Verificado por | Requisitos |
|---|------------|----------------|------------|
| I1 | `resolvePort` es total: toda entrada que no represente un entero de puerto válido devuelve exactamente `3000`, y toda salida cae en `1..65535`. | `src/port.spec.ts` | R1.3 |
| I2 | `toProduct` es fiel y de claves exactas: emite las cinco claves del contrato con los valores de la fila, y no propaga columnas adicionales. | `src/domain/product-mapper.spec.ts` | R2.2, R4.5, R5.4 |
| I3 | Una `category` persistida ajena a `PRODUCT_CATEGORIES` lanza `CorruptProductRowError` con el `id` y el valor inválido, y nunca devuelve un `Product`. | `src/domain/product-mapper.spec.ts` | R4.7 |
| I4 | `findById` resuelve `undefined` sin lanzar cuando no hay fila. | `src/application/catalog.service.spec.ts`, doble en memoria | R4.6 |
| I5 | El catálogo se devuelve ordenado ascendentemente por `id` sin mutar la entrada, de modo que dos peticiones consecutivas producen el mismo arreglo. | `src/domain/product-order.spec.ts`, e2e | R5.5 |
| I6 | El endpoint refleja el catálogo del repositorio sin alterarlo: mismos elementos y orden, `priceCents` y `stock` enteros, `category` como literal sin tilde, y `200` con `[]` cuando está vacío. | `test/products.e2e-spec.ts` | R5.1, R5.2, R5.3, R5.4, R5.6 |
| I7 | Ningún fallo interno filtra información al cliente: el cuerpo del `500` es constante y no contiene el mensaje original, la traza ni la ruta del `.db`. | `src/http/api-exception.filter.spec.ts` | R5.7 |
| I8 | Cada `ErrorCode` tiene un único estado HTTP, sin traducir el código. El `Record<ErrorCode, number>` es exhaustivo, así que **el compilador** es quien lo garantiza cuando la unión crece. | `src/http/api-exception.filter.spec.ts` + `tsc` | R5.7 |
| I9 | El seed es idempotente: `n` ejecuciones consecutivas desde cualquier estado inicial dejan exactamente `CATALOG_PRODUCTS`. | `test/seed.spec.ts` | R3.1, R3.2 |
| I10 | El arranque no muta el estado persistido. **Garantía estructural**, no probada: no existe código de siembra, escritura ni restauración en el bootstrap ni en `PrismaService`. Se demuestra en vivo reiniciando el backend tras un checkout. | revisión de código + demo | R3.6 |
| I11 | La capa de dominio no importa Prisma, NestJS, `express`, `src/infra` ni `src/http`. | `no-restricted-imports` en `eslint.config.mjs` | R4.3 |

Dos de estos invariantes se sostienen sin una prueba dedicada, y es deliberado:

- **I8** lo cierra el sistema de tipos. Un `Record<ErrorCode, number>` deja de compilar en cuanto
  `ERROR_CODES` gana un miembro sin estado asignado. Un test que recorra la unión en runtime
  verifica más tarde y peor lo que `tsc` ya impide.
- **I10** no tiene comportamiento que observar: la propiedad es *la ausencia* de código de escritura
  en el arranque. Probarla exigiría espiar todos los métodos mutadores de Prisma para afirmar que
  nunca se llaman, lo que fija en un test la forma actual de la implementación sin proteger la
  decisión D2. La verificación real es la de la sustentación: reiniciar el proceso y ver que el
  stock decrementado sigue decrementado.
