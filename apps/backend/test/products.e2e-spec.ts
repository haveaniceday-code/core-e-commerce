import { Server } from 'node:net';

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CATALOG_PRODUCTS, ERROR_CODES } from '@core/shared';
import request from 'supertest';

import { isProductCategory } from '../src/domain/product-mapper';
import { PRODUCT_REPOSITORY } from '../src/domain/tokens';
import { ApiExceptionFilter } from '../src/http/api-exception.filter';
import { ProductsModule } from '../src/http/products.module';
import { PrismaService } from '../src/infra/prisma/prisma.service';

import {
  FailingProductRepository,
  InMemoryProductRepository,
} from './doubles/in-memory-product.repository';

import type { INestApplication } from '@nestjs/common';
import type { ErrorCode, Product } from '@core/shared';
import type { ProductRepository } from '../src/domain/product.repository';

/**
 * Prueba end-to-end de `GET /api/products` (invariante I6; BP-R5.3, BP-R5.6, BP-R5.7,
 * BP-R6.3, BP-R6.4).
 *
 * Arranca el modulo HTTP real —controlador, `CatalogService`, prefijo global y filtro de
 * excepciones— y sustituye unicamente la frontera de persistencia. **Sin base de datos:**
 *
 * 1. `PRODUCT_REPOSITORY` se sustituye por el doble en memoria, de modo que
 *    `PrismaProductRepository` nunca se instancia (por eso el adaptador queda fuera de la
 *    medicion de cobertura: esta prueba no lo ejecuta, BP-R6.6).
 * 2. `PrismaService` se sustituye tambien, y no es opcional: `ProductsModule` importa
 *    `PrismaModule`, asi que Nest instanciaria el provider y su `onModuleInit` llamaria a
 *    `$connect`, que exige `DATABASE_URL` y un archivo `.db`. Con el doble no se construye
 *    ningun `PrismaClient` y la suite corre sin base de datos ni variables de entorno
 *    (BP-R6.1).
 *
 * Pruebas por ejemplo, sin generadores: los casos son cuatro y estan fijados por el
 * requisito (catalogo sembrado, catalogo vacio, fallo del repositorio y ruta sin prefijo).
 */

/**
 * Doble inerte del provider Prisma. No implementa `PrismaService`: los tipos de los
 * delegados generados por Prisma son enormes y declararlos exigiria una assertion, que
 * esta prohibida. En su lugar expone los dos metodos que el adaptador usaria y ambos
 * lanzan: si una regresion volviera a enrutar la peticion por Prisma, la prueba falla con
 * un mensaje explicito en lugar de intentar abrir la base.
 */
class UnreachablePrismaService {
  readonly product = {
    findMany: (): never => {
      throw new Error('el e2e corre sin base de datos: nadie debe consultar Prisma');
    },
    findUnique: (): never => {
      throw new Error('el e2e corre sin base de datos: nadie debe consultar Prisma');
    },
  };
}

/**
 * El `getHttpServer()` de Nest devuelve `any`; el `instanceof` lo estrecha sin
 * assertions. Se comprueba contra `net.Server` —la clase base de `http.Server`— porque es
 * exactamente el tipo que acepta supertest y porque su narrowing no arrastra los
 * parametros genericos `any` de `http.Server`.
 */
const httpServerOf = (app: INestApplication): Server => {
  const server: unknown = app.getHttpServer();
  if (server instanceof Server) return server;
  throw new Error('la aplicacion de prueba no expuso un servidor HTTP de node');
};

let app: INestApplication | undefined;

/**
 * Monta la aplicacion tal como lo hara el bootstrap: prefijo global `api` y
 * `ApiExceptionFilter` como filtro global. `logger: false` silencia el log de rutas de
 * Nest y el `logger.error` del filtro, que ya tiene su propia prueba unitaria.
 */
const startApp = async (repository: ProductRepository): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [ProductsModule] })
    .overrideProvider(PRODUCT_REPOSITORY)
    .useValue(repository)
    .overrideProvider(PrismaService)
    .useValue(new UnreachablePrismaService())
    .compile();

  const created = moduleRef.createNestApplication({ logger: false });
  created.setGlobalPrefix('api');
  created.useGlobalFilters(new ApiExceptionFilter());
  await created.init();

  app = created;
  return created;
};

const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error');

beforeEach(() => {
  loggerErrorSpy.mockReset();
  loggerErrorSpy.mockImplementation(() => undefined);
});

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

afterAll(() => {
  loggerErrorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Lectura tipada del cuerpo JSON: `body` de superagent es `any`, asi que se valida
// con predicados antes de compararlo. La validacion es en si misma la afirmacion de
// BP-R5.3 (cinco claves exactas) y BP-R5.4 (enteros y literal sin tilde).
// ---------------------------------------------------------------------------

const PRODUCT_KEYS = ['category', 'id', 'name', 'priceCents', 'stock'] as const;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const isInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

/** Estrecha un elemento del arreglo JSON a `Product` o falla describiendo el motivo. */
const readProduct = (value: unknown): Product => {
  if (!isRecord(value)) {
    throw new Error(`el elemento del catalogo no es un objeto JSON: ${JSON.stringify(value)}`);
  }

  const keys = [...Object.keys(value)].sort();
  if (keys.join(',') !== PRODUCT_KEYS.join(',')) {
    throw new Error(`el producto no expone exactamente las cinco claves del contrato: ${keys.join(',')}`);
  }

  const { id, name, category, priceCents, stock } = value;
  if (typeof id !== 'string' || typeof name !== 'string') {
    throw new Error('`id` y `name` deben viajar como cadenas');
  }
  if (typeof category !== 'string' || !isProductCategory(category)) {
    throw new Error(`la categoria no es un literal de PRODUCT_CATEGORIES: ${JSON.stringify(category)}`);
  }
  if (!isInteger(priceCents) || !isInteger(stock)) {
    throw new Error('`priceCents` y `stock` deben viajar como enteros JSON');
  }

  return { id, name, category, priceCents, stock };
};

const readCatalog = (body: unknown): readonly Product[] => {
  if (!isUnknownArray(body)) {
    throw new Error(`el cuerpo de /api/products no es un arreglo JSON: ${JSON.stringify(body)}`);
  }
  return body.map(readProduct);
};

/** Recorre la union canonica en lugar de redeclararla: `ERROR_CODES` es su unica fuente. */
const isErrorCode = (value: unknown): value is ErrorCode =>
  ERROR_CODES.some((code: ErrorCode) => code === value);

/** Estrecha el cuerpo de error a la forma `ApiError` del contrato compartido. */
const readApiError = (body: unknown): { readonly code: ErrorCode; readonly message: string } => {
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message } = body.error;
    if (isErrorCode(code) && typeof message === 'string') return { code, message };
  }
  throw new Error(`el cuerpo no respeta la forma ApiError: ${JSON.stringify(body)}`);
};

// ---------------------------------------------------------------------------
// Catalogo sembrado (BP-R5.3, BP-R5.4, BP-R5.5)
// ---------------------------------------------------------------------------

describe('GET /api/products con el catalogo sembrado (I6)', () => {
  it('responde 200 con JSON', async () => {
    const created = await startApp(new InMemoryProductRepository());

    const response = await request(httpServerOf(created)).get('/api/products');

    expect(response.status).toBe(200);
    expect(response.type).toBe('application/json');
  });

  it('devuelve seis elementos con las cinco claves y los valores de CATALOG_PRODUCTS', async () => {
    const created = await startApp(new InMemoryProductRepository());

    const response = await request(httpServerOf(created)).get('/api/products');
    const payload: unknown = response.body;
    const catalog = readCatalog(payload);

    expect(catalog).toHaveLength(6);
    expect(catalog).toStrictEqual(CATALOG_PRODUCTS);
  });

  it('emite las categorias como literales sin tilde', async () => {
    const created = await startApp(new InMemoryProductRepository());

    const response = await request(httpServerOf(created)).get('/api/products');
    const payload: unknown = response.body;

    expect(readCatalog(payload).map((product) => product.category)).toStrictEqual([
      'Tecnologia',
      'Tecnologia',
      'Tecnologia',
      'Hogar',
      'Hogar',
      'Ropa',
    ]);
    expect(JSON.stringify(payload)).not.toContain('Tecnología');
  });

  it('ordena ascendentemente por id aunque el repositorio entregue otro orden', async () => {
    const reversed: readonly Product[] = [...CATALOG_PRODUCTS].reverse();
    const created = await startApp(new InMemoryProductRepository(reversed));

    const response = await request(httpServerOf(created)).get('/api/products');
    const payload: unknown = response.body;
    const ids = readCatalog(payload).map((product) => product.id);

    expect(ids).toStrictEqual(['PROD-001', 'PROD-002', 'PROD-003', 'PROD-004', 'PROD-005', 'PROD-006']);
    expect(ids).toStrictEqual([...ids].sort());
  });

  it('es determinista entre peticiones y delega una vez por peticion', async () => {
    const repository = new InMemoryProductRepository();
    const created = await startApp(repository);

    const primera = await request(httpServerOf(created)).get('/api/products');
    const segunda = await request(httpServerOf(created)).get('/api/products');

    expect(segunda.text).toBe(primera.text);
    expect(repository.findAllCalls).toBe(2);
    expect(repository.findByIdCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Catalogo vacio (BP-R5.6)
// ---------------------------------------------------------------------------

describe('GET /api/products con la tabla vacia (BP-R5.6)', () => {
  it('responde 200 con un arreglo vacio, no 404 ni 500', async () => {
    const created = await startApp(new InMemoryProductRepository([]));

    const response = await request(httpServerOf(created)).get('/api/products');
    const payload: unknown = response.body;

    expect(response.status).toBe(200);
    expect(readCatalog(payload)).toStrictEqual([]);
    expect(response.text).toBe('[]');
  });
});

// ---------------------------------------------------------------------------
// Fallo del repositorio (BP-R5.7, BP-R6.3)
// ---------------------------------------------------------------------------

const DB_PATH_FRAGMENT = '/prisma/dev.db';
const SQL_FRAGMENT = 'SELECT "id", "stock" FROM "Product"';

/** Fallo del adaptador con todo lo que jamas debe salir al cliente. */
const leakyRepositoryError = (): Error => {
  const error = new Error(
    `Invalid \`prisma.product.findMany()\` invocation: unable to open the database file ${DB_PATH_FRAGMENT}. Query: ${SQL_FRAGMENT}`,
  );
  error.stack = `Error: unable to open ${DB_PATH_FRAGMENT}\n    at PrismaProductRepository.findAll`;

  return error;
};

describe('GET /api/products cuando el repositorio falla (BP-R5.7, BP-R6.3)', () => {
  it('responde 500 con la forma ApiError y el codigo INTERNAL_ERROR', async () => {
    const created = await startApp(new FailingProductRepository(leakyRepositoryError()));

    const response = await request(httpServerOf(created)).get('/api/products');
    const payload: unknown = response.body;

    expect(response.status).toBe(500);
    expect(response.type).toBe('application/json');
    expect(readApiError(payload)).toStrictEqual({
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor.',
    });
  });

  it('no filtra la ruta del .db, la consulta ni la traza', async () => {
    const created = await startApp(new FailingProductRepository(leakyRepositoryError()));

    const response = await request(httpServerOf(created)).get('/api/products');

    expect(response.text).not.toContain(DB_PATH_FRAGMENT);
    expect(response.text).not.toContain(SQL_FRAGMENT);
    expect(response.text).not.toContain('PrismaProductRepository');
    expect(response.text).toBe(
      '{"error":{"code":"INTERNAL_ERROR","message":"Error interno del servidor."}}',
    );
  });

  it('registra el fallo del lado servidor', async () => {
    const created = await startApp(new FailingProductRepository(leakyRepositoryError()));

    await request(httpServerOf(created)).get('/api/products');

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Prefijo global (BP-R6.4)
// ---------------------------------------------------------------------------

describe('el catalogo solo se publica bajo /api (BP-R6.4)', () => {
  it('GET /products responde 404', async () => {
    const created = await startApp(new InMemoryProductRepository());

    const response = await request(httpServerOf(created)).get('/products');

    expect(response.status).toBe(404);
  });

  it('la ruta sin prefijo no toca el repositorio', async () => {
    const repository = new InMemoryProductRepository();
    const created = await startApp(repository);

    await request(httpServerOf(created)).get('/products');

    expect(repository.findAllCalls).toBe(0);
  });
});
