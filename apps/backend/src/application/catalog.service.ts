import { Inject, Injectable } from '@nestjs/common';
import type { Product } from '@core/shared';

import type { ProductRepository } from '../domain/product.repository';
import { PRODUCT_REPOSITORY } from '../domain/tokens';

/**
 * Caso de uso del catalogo. Depende del puerto `ProductRepository`, nunca de Prisma:
 * el binding del token vive en el modulo HTTP (BP-R4.4).
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
  ) {}

  /** Sin filtros, sin transformaciones: el catalogo tal cual lo entrega el puerto (BP-R5.2). */
  listCatalog(): Promise<readonly Product[]> {
    return this.products.findAll();
  }
}
