import { Injectable } from '@nestjs/common';
import type { Product } from '@core/shared';

import { toProduct } from '../../domain/product-mapper';

import { PrismaService } from './prisma.service';

import type { ProductRepository } from '../../domain/product.repository';

/**
 * Adaptador Prisma del puerto `ProductRepository`. Consulta y delega: el mapeo runtime
 * vive en `toProduct` y el orden es parte del contrato del puerto (BP-R5.5). Al no tener
 * logica propia, queda fuera de la medicion de cobertura (BP-R6.6, D4).
 */
@Injectable()
export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<readonly Product[]> {
    const rows = await this.prisma.product.findMany({ orderBy: { id: 'asc' } });
    return rows.map(toProduct); // la fila de Prisma satisface PersistedProductRow
  }

  /**
   * `null` de Prisma se convierte a `undefined` aqui y no mas arriba: el dominio expresa
   * ausencia con `undefined`, igual que `findProductById` de `@core/shared` (BP-R4.6).
   */
  async findById(id: string): Promise<Product | undefined> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    return row === null ? undefined : toProduct(row);
  }
}
