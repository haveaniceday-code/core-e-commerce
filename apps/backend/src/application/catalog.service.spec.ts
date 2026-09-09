import { CATALOG_PRODUCTS } from '@core/shared';

import {
  FailingProductRepository,
  InMemoryProductRepository,
} from '../../test/doubles/in-memory-product.repository';
import { CatalogService } from './catalog.service';

import type { ProductRepository } from '../domain/product.repository';
import type { Product } from '@core/shared';

/**
 * Pruebas por ejemplo de `CatalogService`, con los dobles tipados de la tarea 5.1.
 *
 * Cubre:
 * - catalogo sembrado, catalogo vacio y fallo del repositorio (BP-R6.3),
 * - una unica llamada a `findAll` por invocacion (BP-R6.2),
 * - invariante I4: `findById` de un id ausente resuelve `undefined` sin lanzar (BP-R4.6).
 *
 * El servicio se instancia directamente con `new`: la inyeccion la resuelve Nest en
 * `ProductsModule` y probarla aqui verificaria el contenedor, no el caso de uso.
 *
 * Requisitos: BP-R4.6, BP-R6.2, BP-R6.3.
 */

const ids = (products: readonly Product[]): readonly string[] => products.map((p) => p.id);

describe('CatalogService.listCatalog: catalogo sembrado (BP-R6.3)', () => {
  it('devuelve los seis productos del seed sin filtrar ni transformar', async () => {
    const repository = new InMemoryProductRepository();
    const service = new CatalogService(repository);

    await expect(service.listCatalog()).resolves.toStrictEqual(CATALOG_PRODUCTS);
  });

  it('respeta el orden ascendente por id que promete el puerto', async () => {
    // El doble recibe el catalogo invertido: si el servicio devolviera lo que le
    // pasaron sin honrar el contrato, este orden saldria al reves.
    const repository = new InMemoryProductRepository([...CATALOG_PRODUCTS].reverse());
    const service = new CatalogService(repository);

    await expect(service.listCatalog().then(ids)).resolves.toStrictEqual(ids(CATALOG_PRODUCTS));
  });

  it('devuelve exactamente lo que entrega el repositorio, sin recortar claves', async () => {
    const repository = new InMemoryProductRepository();
    const service = new CatalogService(repository);

    const [first] = await service.listCatalog();

    expect(first).toStrictEqual({
      id: 'PROD-001',
      name: 'Laptop Pro 14"',
      category: 'Tecnologia',
      priceCents: 129900,
      stock: 5,
    });
  });
});

describe('CatalogService.listCatalog: catalogo vacio (BP-R6.3)', () => {
  it('resuelve un arreglo vacio sin lanzar', async () => {
    const service = new CatalogService(new InMemoryProductRepository([]));

    await expect(service.listCatalog()).resolves.toStrictEqual([]);
  });

  it('un catalogo vacio no es un error: no hay rechazo de la promesa', async () => {
    const repository = new InMemoryProductRepository([]);
    const service = new CatalogService(repository);

    await service.listCatalog();

    expect(repository.findAllCalls).toBe(1);
  });
});

describe('CatalogService.listCatalog: fallo del repositorio (BP-R6.3)', () => {
  it('propaga el rechazo sin envolverlo, para que lo traduzca el filtro HTTP', async () => {
    const failure = new Error('SQLITE_CANTOPEN: unable to open /prisma/dev.db');
    const service = new CatalogService(new FailingProductRepository(failure));

    await expect(service.listCatalog()).rejects.toBe(failure);
  });

  it('no captura ni sustituye el mensaje del adaptador', async () => {
    const failure = new Error('select "id" from "Product" -- fallo');
    const service = new CatalogService(new FailingProductRepository(failure));

    await expect(service.listCatalog()).rejects.toThrow(
      'select "id" from "Product" -- fallo',
    );
  });
});

describe('CatalogService.listCatalog: delegacion unica (BP-R6.2)', () => {
  it('una invocacion produce exactamente una llamada a findAll', async () => {
    const repository = new InMemoryProductRepository();
    const service = new CatalogService(repository);

    await service.listCatalog();

    expect(repository.findAllCalls).toBe(1);
  });

  it('tres invocaciones producen tres llamadas: no hay cache oculta', async () => {
    const repository = new InMemoryProductRepository();
    const service = new CatalogService(repository);

    await service.listCatalog();
    await service.listCatalog();
    await service.listCatalog();

    expect(repository.findAllCalls).toBe(3);
  });

  it('no toca findById para listar el catalogo', async () => {
    const repository = new InMemoryProductRepository();
    const service = new CatalogService(repository);

    await service.listCatalog();

    expect(repository.findByIdCalls).toBe(0);
  });
});

interface FindByIdCase {
  readonly title: string;
  readonly id: string;
}

/** Ids ausentes del catalogo sembrado: ninguno debe lanzar. */
const MISSING_ID_CASES: readonly FindByIdCase[] = [
  { title: 'id inexistente con el prefijo del catalogo', id: 'PROD-999' },
  { title: 'id vacio', id: '' },
  { title: 'id con distinta capitalizacion', id: 'prod-001' },
  { title: 'id con espacios alrededor', id: ' PROD-001 ' },
];

describe('ProductRepository.findById: ausencia tipada (invariante I4, BP-R4.6)', () => {
  it.each([...MISSING_ID_CASES])(
    'resuelve undefined sin lanzar para $title',
    async ({ id }: FindByIdCase) => {
      const repository: ProductRepository = new InMemoryProductRepository();

      await expect(repository.findById(id)).resolves.toBeUndefined();
    },
  );

  it('un id presente resuelve el producto completo', async () => {
    const repository: ProductRepository = new InMemoryProductRepository();

    await expect(repository.findById('PROD-005')).resolves.toStrictEqual({
      id: 'PROD-005',
      name: 'Juego de Sábanas',
      category: 'Hogar',
      priceCents: 5900,
      stock: 3,
    });
  });

  it('sobre un catalogo vacio cualquier id resuelve undefined', async () => {
    const repository: ProductRepository = new InMemoryProductRepository([]);

    await expect(repository.findById('PROD-001')).resolves.toBeUndefined();
  });
});
