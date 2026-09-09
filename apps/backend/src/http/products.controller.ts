import { Controller, Get } from '@nestjs/common';
import type { Product } from '@core/shared';

import { CatalogService } from '../application/catalog.service';

/**
 * Orquesta y nada mas (BP-R5.1): recibe, delega en el caso de uso y devuelve su promesa.
 * Sin try/catch -la traduccion del fallo es del ApiExceptionFilter-, sin acceso al
 * cliente Prisma y sin reglas de negocio.
 */
@Controller('products') // con el prefijo global => GET /api/products
export class ProductsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  getProducts(): Promise<readonly Product[]> {
    return this.catalog.listCatalog();
  }
}
