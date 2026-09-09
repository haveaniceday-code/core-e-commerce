import { Module } from '@nestjs/common';

import { CheckoutModule } from './http/checkout.module';
import { ProductsModule } from './http/products.module';
import { PrismaModule } from './infra/prisma/prisma.module';

/**
 * Raiz de la aplicacion: solo composicion. `PrismaModule` se importa aqui para que la
 * conexion sea un unico singleton del proceso, `ProductsModule` aporta el endpoint del
 * catalogo con su binding de repositorio (BP-R4.4) y `CheckoutModule` los dos endpoints
 * de checkout con los bindings de `PRODUCT_REPOSITORY` y `PURCHASE_PORT` (BC-R6.2).
 *
 * Cada modulo de feature declara los puertos que consume, asi que la raiz no contiene
 * ningun binding propio: no hay un solo lugar donde la eleccion de infraestructura este
 * centralizada, y es deliberado, porque es lo que permite que un e2e arranque un modulo
 * suelto y sustituya sus adaptadores sin arrastrar el resto de la aplicacion.
 */
@Module({ imports: [PrismaModule, ProductsModule, CheckoutModule] })
export class AppModule {}
