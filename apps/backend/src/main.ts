import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { resolvePort } from './port';

/**
 * Bootstrap del proceso: solo composicion, sin logica de negocio (BP-R1.1, BP-R1.2).
 *
 * El `ValidationPipe` se registra ya en esta entrega aunque todavia no exista un DTO de
 * entrada: es la costura que `POST /api/checkout` consume despues sin reconfigurar nada.
 * El arranque no siembra, no migra y no escribe: la persistencia solo se conecta (D2).
 */
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
