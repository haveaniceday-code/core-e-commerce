import type { Product } from '@core/shared';

export interface ProductRepository {
  /**
   * Catalogo completo, SIEMPRE en orden ascendente por `id` (BP-R5.5).
   * El orden es parte del contrato, no un detalle del adaptador: si viviera solo
   * en el `orderBy` de Prisma, un doble de prueba podria devolver otro orden y el
   * e2e pasaria afirmando algo que produccion no garantiza.
   */
  findAll(): Promise<readonly Product[]>;

  /** Ausencia tipada, sin excepcion (BP-R4.6). */
  findById(id: string): Promise<Product | undefined>;
}
