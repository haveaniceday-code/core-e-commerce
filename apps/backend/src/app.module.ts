import { Module } from '@nestjs/common';

import { ProductsModule } from './http/products.module';
import { PrismaModule } from './infra/prisma/prisma.module';

/**
 * Raiz de la aplicacion: solo composicion. `PrismaModule` se importa aqui para que la
 * conexion sea un unico singleton del proceso, y `ProductsModule` aporta el endpoint del
 * catalogo con su binding de repositorio (BP-R4.4).
 */
@Module({ imports: [PrismaModule, ProductsModule] })
export class AppModule {}
