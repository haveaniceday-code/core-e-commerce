import type { ProductCategory } from './categories';

/**
 * Producto del catalogo (SCS-R1.3).
 *
 * `priceCents` y `stock` son enteros no negativos. La restriccion no es
 * expresable en el tipo estructural: la garantizan el seed (verificado en
 * compilacion) y la validacion en runtime del motor (DE-R5).
 */
export interface Product {
  readonly id: string;
  readonly name: string;
  readonly category: ProductCategory;
  readonly priceCents: number;
  readonly stock: number;
}

/** Linea de carrito tal como la envia el cliente (SCS-R1.4). */
export interface CartItem {
  readonly productId: string;
  readonly quantity: number;
}
