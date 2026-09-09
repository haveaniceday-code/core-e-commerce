import { Module } from '@nestjs/common';

import { CheckoutService } from '../application/checkout.service';
import { PRODUCT_REPOSITORY, PURCHASE_PORT } from '../domain/tokens';
import { PrismaModule } from '../infra/prisma/prisma.module';
import { PrismaProductRepository } from '../infra/prisma/prisma-product.repository';
import { PrismaPurchaseConfirmation } from '../infra/prisma/prisma-purchase.repository';

import { CheckoutController } from './checkout.controller';

/**
 * Cierra la cadena de `POST /api/checkout/preview` y `POST /api/checkout`.
 *
 * Los bindings de los dos puertos que consume `CheckoutService` viven aqui y en ningun
 * otro lugar (BC-R6.2): es el unico punto donde la eleccion de infraestructura es
 * visible, asi que el e2e la sustituye con `.overrideProvider(PRODUCT_REPOSITORY)` y
 * `.overrideProvider(PURCHASE_PORT)` sin tocar el dominio, la aplicacion ni el
 * controlador. El servicio solo conoce los tokens, nunca las clases concretas.
 *
 * `PRODUCT_REPOSITORY` se declara de nuevo en este modulo en lugar de reexportarse
 * desde `ProductsModule`, y es deliberado: cada modulo de feature declara los puertos
 * que consume, de modo que el e2e del checkout pueda sustituir el catalogo sin arrastrar
 * el endpoint de productos ni depender de que otro modulo exporte el token.
 *
 * Los dos bindings entran por `useClass`, no por instancia: el contenedor resuelve
 * `PrismaService` desde `PrismaModule` y lo inyecta en ambos adaptadores, de modo que la
 * conexion sigue siendo el singleton del proceso (BC-R6.4).
 */
@Module({
  imports: [PrismaModule],
  controllers: [CheckoutController],
  providers: [
    CheckoutService,
    { provide: PRODUCT_REPOSITORY, useClass: PrismaProductRepository },
    { provide: PURCHASE_PORT, useClass: PrismaPurchaseConfirmation },
  ],
})
export class CheckoutModule {}
