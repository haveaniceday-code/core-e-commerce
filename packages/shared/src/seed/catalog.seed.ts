import type { Product } from '../domain/product';

/**
 * Catalogo canonico (SCS-R2.1). Valores transcritos desde
 * .kiro/steering/product-rules.md, que es su unica fuente.
 *
 * `as const satisfies` es la forma correcta bajo las reglas de tipado:
 * `as const` estrecha (permitido y preferido) y `satisfies` VERIFICA contra el
 * contrato sin ensanchar. `as readonly Product[]` seria una assertion prohibida
 * y ademas afirmaria sin comprobar. Si un precio cambiara a string o una
 * categoria llevara tilde, la compilacion falla en la linea exacta.
 *
 * PROD-005 tiene stock 3 a proposito: es el producto con el que se demuestra en
 * vivo el rechazo por stock insuficiente.
 */
export const CATALOG_PRODUCTS = [
  { id: 'PROD-001', name: 'Laptop Pro 14"',        category: 'Tecnologia', priceCents: 129900, stock: 5  },
  { id: 'PROD-002', name: 'Auriculares Bluetooth', category: 'Tecnologia', priceCents: 7990,   stock: 12 },
  { id: 'PROD-003', name: 'Teclado Mecánico',      category: 'Tecnologia', priceCents: 4550,   stock: 8  },
  { id: 'PROD-004', name: 'Lámpara de Escritorio', category: 'Hogar',      priceCents: 3200,   stock: 15 },
  { id: 'PROD-005', name: 'Juego de Sábanas',      category: 'Hogar',      priceCents: 5900,   stock: 3  },
  { id: 'PROD-006', name: 'Camiseta Básica',       category: 'Ropa',       priceCents: 1990,   stock: 20 },
] as const satisfies readonly Product[];

/**
 * Acepta un catalogo opcional porque el motor resuelve contra el catalogo que
 * recibe en su input, no contra el seed global (DE-R5.3), y los tests necesitan
 * catalogos a medida. Ausencia = undefined, sin excepcion (SCS-R2.5).
 */
export const findProductById = (
  id: string,
  catalog: readonly Product[] = CATALOG_PRODUCTS,
): Product | undefined => catalog.find((p) => p.id === id);
