import { CATALOG_PRODUCTS } from '@core/shared';

import {
  FailingProductRepository,
  InMemoryProductRepository,
} from '../../test/doubles/in-memory-product.repository';
import { CatalogService } from '../application/catalog.service';
import { ProductsController } from './products.controller';

import type { Product } from '@core/shared';

/**
 * Pruebas por ejemplo de `ProductsController` (BP-R5.1, BP-R6.2).
 *
 * Lo unico que este controller promete es orquestar: una sola llamada al caso de uso y
 * devolver su promesa tal cual, sin transformar, sin reordenar y sin `try/catch`. Por eso
 * las afirmaciones son de delegacion e identidad de referencias, no de contenido
 * calculado: el contenido ya lo cubre `catalog.service.spec.ts`.
 *
 * Los dobles son subclases tipadas de `CatalogService`, no espias: el compilador verifica
 * que la superficie publica coincide, y no hace falta `any`, assertions ni `@ts-ignore`.
 * El controller se instancia con `new`; la inyeccion la resuelve Nest en el modulo y
 * probarla aqui verificaria el contenedor, no el orquestador.
 *
 * Requisitos: BP-R5.1, BP-R6.2.
 */

/**
 * Doble que cuenta las llamadas y devuelve **siempre la misma promesa** sobre **el mismo
 * arreglo** que se le paso. Esa estabilidad de referencias es lo que permite afirmar que
 * el controller no copia, no mapea ni reordena: si lo hiciera, `toBe` fallaria aunque
 * `toStrictEqual` siguiera pasando.
 */
class StubCatalogService extends CatalogService {
  public listCatalogCalls = 0;

  public readonly rows: readonly Product[];

  private readonly result: Promise<readonly Product[]>;

  constructor(rows: readonly Product[]) {
    // El repositorio del padre queda inerte: `listCatalog` esta sobrescrito y nunca lo
    // consulta. Se pasa uno real solo porque el constructor lo exige, y su contador
    // sirve de testigo de que el doble no lo toca.
    super(new InMemoryProductRepository(rows));
    this.rows = rows;
    this.result = Promise.resolve(rows);
  }

  override listCatalog(): Promise<readonly Product[]> {
    this.listCatalogCalls += 1;
    return this.result;
  }
}

/**
 * Doble que cuenta y delega en el caso de uso real. Se usa para el camino de fallo:
 * asi el rechazo lo produce el puerto, como en produccion, y se comprueba que atraviesa
 * el controller sin capturarse.
 */
class DelegatingCatalogService extends CatalogService {
  public listCatalogCalls = 0;

  override listCatalog(): Promise<readonly Product[]> {
    this.listCatalogCalls += 1;
    return super.listCatalog();
  }
}

const ids = (products: readonly Product[]): readonly string[] => products.map((p) => p.id);

describe('ProductsController.getProducts: delegacion unica (BP-R6.2)', () => {
  it('una invocacion produce exactamente una llamada a listCatalog', async () => {
    const catalog = new StubCatalogService(CATALOG_PRODUCTS);
    const controller = new ProductsController(catalog);

    await controller.getProducts();

    expect(catalog.listCatalogCalls).toBe(1);
  });

  it('tres invocaciones producen tres llamadas: el controller no cachea', async () => {
    const catalog = new StubCatalogService(CATALOG_PRODUCTS);
    const controller = new ProductsController(catalog);

    await controller.getProducts();
    await controller.getProducts();
    await controller.getProducts();

    expect(catalog.listCatalogCalls).toBe(3);
  });

  it('no llama al caso de uso hasta que se invoca el handler', () => {
    const catalog = new StubCatalogService(CATALOG_PRODUCTS);
    new ProductsController(catalog);

    expect(catalog.listCatalogCalls).toBe(0);
  });

  it('devuelve la misma promesa que el servicio, sin envolverla', () => {
    const catalog = new StubCatalogService(CATALOG_PRODUCTS);
    const controller = new ProductsController(catalog);

    const first = controller.getProducts();
    const second = controller.getProducts();

    // El doble devuelve una promesa estable: si el controller hiciera `await`, `then`
    // o `Promise.resolve(...)` sobre ella, estas referencias no coincidirian.
    expect(first).toBe(second);
  });

  it('no accede al repositorio por su cuenta: solo pasa por el caso de uso', async () => {
    const repository = new InMemoryProductRepository();
    const catalog = new DelegatingCatalogService(repository);
    const controller = new ProductsController(catalog);

    await controller.getProducts();

    expect(catalog.listCatalogCalls).toBe(1);
    expect(repository.findAllCalls).toBe(1);
    expect(repository.findByIdCalls).toBe(0);
  });
});

describe('ProductsController.getProducts: devuelve el catalogo sin transformarlo (BP-R5.1)', () => {
  it('resuelve los seis productos del seed con todas sus claves', async () => {
    const controller = new ProductsController(new StubCatalogService(CATALOG_PRODUCTS));

    await expect(controller.getProducts()).resolves.toStrictEqual(CATALOG_PRODUCTS);
  });

  it('devuelve el mismo arreglo que entrego el servicio, sin copiarlo ni mapearlo', async () => {
    const catalog = new StubCatalogService(CATALOG_PRODUCTS);
    const controller = new ProductsController(catalog);

    await expect(controller.getProducts()).resolves.toBe(catalog.rows);
  });

  it('no reordena: si el servicio devuelve el catalogo invertido, eso es lo que sale', async () => {
    const reversed = [...CATALOG_PRODUCTS].reverse();
    const controller = new ProductsController(new StubCatalogService(reversed));

    // El orden es contrato del puerto, no del controller. Un `sort` aqui seria un
    // segundo dueno del orden y este caso lo delata.
    await expect(controller.getProducts().then(ids)).resolves.toStrictEqual(ids(reversed));
  });

  it('un catalogo vacio resuelve un arreglo vacio, no un error', async () => {
    const controller = new ProductsController(new StubCatalogService([]));

    await expect(controller.getProducts()).resolves.toStrictEqual([]);
  });

  it('no recorta ni renombra claves del producto', async () => {
    const controller = new ProductsController(new StubCatalogService(CATALOG_PRODUCTS));

    const [first] = await controller.getProducts();

    expect(first).toStrictEqual({
      id: 'PROD-001',
      name: 'Laptop Pro 14"',
      category: 'Tecnologia',
      priceCents: 129900,
      stock: 5,
    });
  });
});

describe('ProductsController.getProducts: sin try/catch (BP-R5.1)', () => {
  it('propaga el rechazo del caso de uso para que lo traduzca el filtro HTTP', async () => {
    const failure = new Error('SQLITE_CANTOPEN: unable to open /prisma/dev.db');
    const controller = new ProductsController(
      new DelegatingCatalogService(new FailingProductRepository(failure)),
    );

    await expect(controller.getProducts()).rejects.toBe(failure);
  });

  it('no sustituye el fallo por un catalogo vacio ni por otro mensaje', async () => {
    const failure = new Error('select "id" from "Product" -- fallo');
    const catalog = new DelegatingCatalogService(new FailingProductRepository(failure));
    const controller = new ProductsController(catalog);

    await expect(controller.getProducts()).rejects.toThrow(
      'select "id" from "Product" -- fallo',
    );
    expect(catalog.listCatalogCalls).toBe(1);
  });
});
