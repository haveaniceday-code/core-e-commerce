import { Module } from '@nestjs/common';

import { CatalogService } from '../application/catalog.service';
import { PRODUCT_REPOSITORY } from '../domain/tokens';
import { PrismaModule } from '../infra/prisma/prisma.module';
import { PrismaProductRepository } from '../infra/prisma/prisma-product.repository';

import { ProductsController } from './products.controller';

/**
 * Cierra la cadena del endpoint `GET /api/products`. El binding
 * `PRODUCT_REPOSITORY -> PrismaProductRepository` vive aqui y en ningun otro lugar
 * (BP-R4.4): es el unico punto donde la eleccion de infraestructura es visible, asi que
 * el e2e puede sustituirla con `.overrideProvider(PRODUCT_REPOSITORY)` sin tocar el
 * dominio ni la aplicacion.
 *
 * Si el token no estuviera provisto, el contenedor de Nest falla al compilar el modulo
 * senalando el token: comportamiento del framework, no se prueba en esta suite.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ProductsController],
  providers: [
    CatalogService,
    { provide: PRODUCT_REPOSITORY, useClass: PrismaProductRepository },
  ],
})
export class ProductsModule {}
