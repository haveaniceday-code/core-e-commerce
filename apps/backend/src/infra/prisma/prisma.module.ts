import { Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Provee y exporta el unico `PrismaService` del proceso, de modo que los adaptadores
 * de infraestructura reciban la misma conexion por inyeccion (BP-R2.6).
 */
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
