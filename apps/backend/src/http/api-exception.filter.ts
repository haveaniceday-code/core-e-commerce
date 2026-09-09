import { Catch, HttpException, Logger } from '@nestjs/common';
import { isDiscountDomainError } from '@core/shared';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError, ErrorCode } from '@core/shared';

/** Exhaustivo por construccion: anadir un ErrorCode sin estado rompe la compilacion. */
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

/**
 * Unico traductor de excepciones a HTTP (BP-R5.7). Los controladores y servicios no
 * capturan: lanzan, y el filtro decide estado y cuerpo.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    // Errores de dominio: el codigo viaja tal cual y el estado sale de la tabla.
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

    // Todo lo demas -fallo del repositorio, fila corrupta, caida de SQLite- se
    // registra completo del lado servidor y sale al cliente como cuerpo generico:
    // ni el mensaje original, ni la consulta, ni la ruta del .db, ni la traza.
    this.logger.error('Fallo no controlado', exception);
    response.status(500).json(internalError());
  }
}
