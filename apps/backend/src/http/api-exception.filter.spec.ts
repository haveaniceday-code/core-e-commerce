import { BadRequestException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { DiscountDomainError, ERROR_CODES } from '@core/shared';

import { ApiExceptionFilter } from './api-exception.filter';

import type { ApiError, ErrorCode } from '@core/shared';

/**
 * Invariantes I7 (ningun fallo interno filtra informacion al cliente) e I8 (cada
 * `ErrorCode` tiene un unico estado HTTP, sin traducir el codigo).
 *
 * Pruebas por ejemplo, sin generadores: las ramas del filtro son tres y los codigos
 * de error son un conjunto cerrado, asi que `it.each` sobre `ERROR_CODES` los recorre
 * completos. La exhaustividad del `Record<ErrorCode, number>` de la implementacion la
 * garantiza `tsc`: aqui se cubre el comportamiento, no la completitud de la union.
 *
 * Requisitos: BP-R5.7, BP-R6.3.
 */

/**
 * Doble tipado del `Response` de express. Solo registra: `status()` devuelve `this`
 * para sostener el encadenamiento `status(...).json(...)` que usa el filtro, y el
 * orden de las llamadas queda anotado para poder afirmar que el estado se fija antes
 * del cuerpo.
 */
class ResponseDouble {
  readonly statusCalls: number[] = [];
  readonly jsonCalls: unknown[] = [];
  readonly callOrder: string[] = [];

  status(code: number): this {
    this.statusCalls.push(code);
    this.callOrder.push('status');
    return this;
  }

  json(body: unknown): this {
    this.jsonCalls.push(body);
    this.callOrder.push('json');
    return this;
  }
}

/**
 * Invoca el filtro con un `ArgumentsHost` real de Nest. Se usa `ExecutionContextHost`
 * en lugar de un objeto literal porque `ArgumentsHost` declara metodos genericos
 * (`getArgs<T>`, `getArgByIndex<T>`) que no se pueden implementar sin una type
 * assertion, y las assertions estan prohibidas. El doble entra como segundo argumento
 * porque `switchToHttp().getResponse()` lee la posicion 1.
 */
const invokeFilter = (exception: unknown): ResponseDouble => {
  const response = new ResponseDouble();
  const host = new ExecutionContextHost([undefined, response]);

  new ApiExceptionFilter().catch(exception, host);

  return response;
};

/** El log del servidor se silencia para no ensuciar la salida de la suite. */
const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error');

beforeEach(() => {
  loggerErrorSpy.mockReset();
  loggerErrorSpy.mockImplementation(() => undefined);
});

afterAll(() => {
  loggerErrorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// I8: un estado por ErrorCode, sin traducir el codigo
// ---------------------------------------------------------------------------

/**
 * Expectativa independiente de la tabla de la implementacion: si alguien cambia un
 * estado en `STATUS_BY_ERROR_CODE`, este mapa lo delata.
 */
const EXPECTED_STATUS: Record<ErrorCode, number> = {
  INSUFFICIENT_STOCK: 409,
  PRODUCT_NOT_FOUND: 404,
  INVALID_CART: 400,
  INTERNAL_ERROR: 500,
};

const DETAILS_BY_CODE: Record<ErrorCode, Readonly<Record<string, unknown>> | undefined> = {
  INSUFFICIENT_STOCK: { productId: 'PROD-005', requested: 4, available: 3 },
  PRODUCT_NOT_FOUND: { productId: 'PROD-999' },
  INVALID_CART: { productId: 'PROD-001', quantity: -2 },
  INTERNAL_ERROR: undefined,
};

const domainErrorFor = (code: ErrorCode): DiscountDomainError => {
  const message = `mensaje de dominio de ${code}`;
  const details = DETAILS_BY_CODE[code];

  return details === undefined
    ? new DiscountDomainError(code, message)
    : new DiscountDomainError(code, message, details);
};

const isErrorCode = (value: unknown): value is ErrorCode =>
  ERROR_CODES.some((code: ErrorCode) => code === value);

/** Narrowea el cuerpo capturado hasta el codigo sin assertions ni `any`. */
const readErrorCode = (body: unknown): ErrorCode => {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body;
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const { code } = error;
      if (isErrorCode(code)) return code;
    }
  }
  throw new Error('el cuerpo capturado no respeta la forma ApiError');
};

describe('ApiExceptionFilter: DiscountDomainError por cada ErrorCode (I8, BP-R5.7)', () => {
  it.each([...ERROR_CODES])('%s responde con su estado de la tabla', (code: ErrorCode) => {
    const response = invokeFilter(domainErrorFor(code));

    expect(response.statusCalls).toStrictEqual([EXPECTED_STATUS[code]]);
  });

  it.each([...ERROR_CODES])('%s responde con el cuerpo de toApiError()', (code: ErrorCode) => {
    const error = domainErrorFor(code);

    const response = invokeFilter(error);

    expect(response.jsonCalls).toStrictEqual([error.toApiError()]);
  });

  it.each([...ERROR_CODES])('%s viaja al cliente sin traducirse', (code: ErrorCode) => {
    const response = invokeFilter(domainErrorFor(code));

    expect(readErrorCode(response.jsonCalls[0])).toBe(code);
  });

  it.each([...ERROR_CODES])('%s fija el estado antes del cuerpo, una sola vez', (code: ErrorCode) => {
    const response = invokeFilter(domainErrorFor(code));

    expect(response.callOrder).toStrictEqual(['status', 'json']);
  });

  it('conserva los details del error de dominio', () => {
    const response = invokeFilter(domainErrorFor('INSUFFICIENT_STOCK'));

    expect(response.jsonCalls[0]).toStrictEqual({
      error: {
        code: 'INSUFFICIENT_STOCK',
        message: 'mensaje de dominio de INSUFFICIENT_STOCK',
        details: { productId: 'PROD-005', requested: 4, available: 3 },
      },
    });
  });

  it('un error de dominio sin details no emite la clave', () => {
    const response = invokeFilter(domainErrorFor('INTERNAL_ERROR'));

    expect(JSON.stringify(response.jsonCalls[0])).not.toContain('details');
  });

  it.each([...ERROR_CODES])('%s no se registra como fallo no controlado', (code: ErrorCode) => {
    invokeFilter(domainErrorFor(code));

    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HttpException de Nest: conserva estado y cuerpo
// ---------------------------------------------------------------------------

describe('ApiExceptionFilter: HttpException de Nest (BP-R5.7)', () => {
  it('NotFoundException conserva su 404 y su cuerpo', () => {
    const exception = new NotFoundException('Cannot GET /products');

    const response = invokeFilter(exception);

    expect(response.statusCalls).toStrictEqual([404]);
    expect(response.jsonCalls).toStrictEqual([exception.getResponse()]);
  });

  it('BadRequestException del ValidationPipe conserva su 400 y su cuerpo', () => {
    const exception = new BadRequestException({
      statusCode: 400,
      message: ['quantity must be a positive integer'],
      error: 'Bad Request',
    });

    const response = invokeFilter(exception);

    expect(response.statusCalls).toStrictEqual([400]);
    expect(response.jsonCalls).toStrictEqual([
      { statusCode: 400, message: ['quantity must be a positive integer'], error: 'Bad Request' },
    ]);
  });

  it('un cuerpo de texto plano no se envuelve en ApiError', () => {
    const response = invokeFilter(new HttpException('recurso no disponible', 418));

    expect(response.statusCalls).toStrictEqual([418]);
    expect(response.jsonCalls).toStrictEqual(['recurso no disponible']);
  });

  it('no registra la HttpException como fallo no controlado', () => {
    invokeFilter(new NotFoundException('Cannot GET /products'));

    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// I7: el 500 no filtra nada
// ---------------------------------------------------------------------------

const DB_PATH_FRAGMENT = '/prisma/dev.db';
const SQL_FRAGMENT = 'SELECT "id", "stock" FROM "Product" WHERE "id" = ?';
const STACK_FRAGMENT =
  'at PrismaProductRepository.findAll (/Users/dev/core-e-commerce/apps/backend/src/infra/prisma/prisma-product.repository.ts:21:14)';
const PRISMA_INVOCATION_FRAGMENT = 'Invalid `prisma.product.findMany()` invocation';

/** Fallo del repositorio con todo lo que jamas debe salir al cliente. */
const leakyRepositoryError = (): Error => {
  const error = new Error(
    `${PRISMA_INVOCATION_FRAGMENT}: unable to open the database file ${DB_PATH_FRAGMENT}. Query: ${SQL_FRAGMENT}`,
  );
  error.stack = `Error: ${PRISMA_INVOCATION_FRAGMENT} ${DB_PATH_FRAGMENT}\n    ${STACK_FRAGMENT}`;

  return error;
};

/** Cuerpo constante del 500: sin details, sin mensaje original. */
const GENERIC_BODY: ApiError = {
  error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' },
};

describe('ApiExceptionFilter: fallo no controlado no filtra informacion (I7, BP-R5.7)', () => {
  it('responde 500 con el cuerpo generico', () => {
    const response = invokeFilter(leakyRepositoryError());

    expect(response.statusCalls).toStrictEqual([500]);
    expect(response.jsonCalls).toStrictEqual([GENERIC_BODY]);
    expect(response.callOrder).toStrictEqual(['status', 'json']);
  });

  it.each([DB_PATH_FRAGMENT, SQL_FRAGMENT, STACK_FRAGMENT, PRISMA_INVOCATION_FRAGMENT])(
    'el cuerpo serializado no contiene %p',
    (fragment: string) => {
      const response = invokeFilter(leakyRepositoryError());

      expect(JSON.stringify(response.jsonCalls[0])).not.toContain(fragment);
    },
  );

  it('el cuerpo serializado es exactamente el ApiError generico', () => {
    const response = invokeFilter(leakyRepositoryError());

    expect(JSON.stringify(response.jsonCalls[0])).toBe(
      '{"error":{"code":"INTERNAL_ERROR","message":"Error interno del servidor."}}',
    );
  });

  it('registra la excepcion completa del lado servidor', () => {
    const error = leakyRepositoryError();

    invokeFilter(error);

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.any(String), error);
  });

  it('dos fallos distintos producen el mismo cuerpo constante', () => {
    const primero = invokeFilter(leakyRepositoryError());
    const segundo = invokeFilter(new Error(`otro fallo con ${DB_PATH_FRAGMENT}`));

    expect(JSON.stringify(segundo.jsonCalls[0])).toBe(JSON.stringify(primero.jsonCalls[0]));
  });
});

describe('ApiExceptionFilter: excepciones que no son Error (I7, BP-R5.7)', () => {
  /** Duck type de un error de dominio: sin `instanceof`, no se le concede confianza. */
  const domainLookAlike = {
    code: 'INVALID_CART',
    message: `carrito invalido leido de ${DB_PATH_FRAGMENT}`,
    toApiError: (): ApiError => ({
      error: { code: 'INVALID_CART', message: `carrito invalido leido de ${DB_PATH_FRAGMENT}` },
    }),
  };

  const NON_ERROR_CASES: readonly (readonly [string, unknown])[] = [
    ['una cadena lanzada', `fallo crudo en ${DB_PATH_FRAGMENT}`],
    ['un objeto plano', { query: SQL_FRAGMENT, file: DB_PATH_FRAGMENT }],
    ['undefined', undefined],
    ['un duck type de DiscountDomainError', domainLookAlike],
  ];

  it.each(NON_ERROR_CASES)('%s cae en el 500 generico', (_titulo: string, exception: unknown) => {
    const response = invokeFilter(exception);

    expect(response.statusCalls).toStrictEqual([500]);
    expect(response.jsonCalls).toStrictEqual([GENERIC_BODY]);
  });

  it('el duck type no consigue que su codigo viaje al cliente', () => {
    const response = invokeFilter(domainLookAlike);

    expect(readErrorCode(response.jsonCalls[0])).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.jsonCalls[0])).not.toContain(DB_PATH_FRAGMENT);
  });
});
