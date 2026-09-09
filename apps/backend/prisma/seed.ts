// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { CATALOG_PRODUCTS } from '@core/shared';
import type { Product } from '@core/shared';

/**
 * Columnas mutables de una fila del catalogo: lo que el seed reescribe cuando la fila
 * ya existe. `category` es `string` y no la union de literales porque esta es la forma
 * de la COLUMNA (SQLite guarda texto, BP-R2.2); el estrechamiento a `ProductCategory`
 * es responsabilidad del mapeo de lectura (`src/domain/product-mapper.ts`).
 */
export interface SeedProductData {
  readonly name: string;
  readonly category: string;
  readonly priceCents: number;
  readonly stock: number;
}

/** Argumentos del unico `upsert` que el seed necesita emitir. */
export interface ProductUpsertArgs {
  readonly where: { readonly id: string };
  readonly create: SeedProductData & { readonly id: string };
  readonly update: SeedProductData;
}

/**
 * Costura de persistencia del seed, reducida a la unica operacion que ejecuta
 * (BP-R3.2, BP-R6.1).
 *
 * Por que NO es `Pick<PrismaClient, 'product'>`: ese `Pick` arrastra el delegado
 * completo de Prisma (`findMany`, `aggregate`, `groupBy`, `fields`, ...) con sus firmas
 * genericas y sus tipos `$Result`. Un almacen doble no puede satisfacerlo sin una
 * assertion o un `any`, y el tipado estricto no es negociable: prohibido silenciar al
 * compilador. La interfaz estructural minima invierte el problema —el `PrismaClient`
 * real la satisface por estructura, verificado por `tsc` en `main`— y deja el doble de
 * prueba completamente tipado. El proposito de la costura (probar la idempotencia sin
 * base de datos) se conserva intacto.
 */
export interface ProductUpsertClient {
  readonly product: {
    upsert(args: ProductUpsertArgs): Promise<unknown>;
  };
}

/**
 * Upsert por id: idempotente por definición (BP-R3.2). `update` reescribe también el
 * stock, que es lo correcto para un seed —restablece el catálogo canónico— y es
 * justamente por eso que el arranque NO lo ejecuta (D2 / BP-R3.6).
 *
 * El cliente llega por parámetro: es la costura que permite probar la idempotencia
 * contra un almacén doble, sin base de datos (BP-R3.2, BP-R6.1). Los productos vienen
 * de `CATALOG_PRODUCTS` del paquete compartido, de modo que el backend no redeclara
 * ningún dato del catálogo (BP-R3.1).
 */
export const seedProducts = async (
  client: ProductUpsertClient,
  products: readonly Product[] = CATALOG_PRODUCTS,
): Promise<number> => {
  for (const p of products) {
    const data: SeedProductData = {
      name: p.name,
      category: p.category,
      priceCents: p.priceCents,
      stock: p.stock,
    };
    await client.product.upsert({
      where: { id: p.id },
      create: { id: p.id, ...data },
      update: data,
    });
  }
  return products.length;
};

/**
 * Único código con efectos de proceso, y por eso queda fuera de la medición de cobertura:
 * instancia el cliente, informa la cantidad escrita (BP-R3.4) y cierra la conexión en
 * `finally`, tanto si la siembra terminó bien como si falló.
 */
const main = async (): Promise<void> => {
  const client = new PrismaClient();
  try {
    const written = await seedProducts(client);
    console.log(`Seed completado: ${String(written)} productos escritos.`);
  } finally {
    await client.$disconnect();
  }
};

// Se ejecuta solo cuando el archivo es el punto de entrada del proceso (`prisma db seed`).
// Sin esta guarda, importar `seedProducts` desde una prueba abriria una conexion real a
// la base y dejaria `process.exitCode = 1` al fallar, contaminando la suite: el modulo
// tendria efectos de import, no solo de ejecucion.
if (require.main === module) {
  // Fallo al conectar o al escribir: se describe por stderr y el proceso sale con código
  // distinto de 0, de modo que un pipeline lo detecte (BP-R3.5).
  void main().catch((error: unknown) => {
    console.error('Seed fallido:', error);
    process.exitCode = 1;
  });
}
