/**
 * Categorias de producto (SCS-R1.1, SCS-R1.2).
 *
 * El literal interno va SIN TILDE; la tilde existe solo en la etiqueta de UI.
 * Motivo: la comparacion del CategoryDiscount es contra el literal, y una
 * divergencia de tilde produce un fallo silencioso (el descuento simplemente
 * no se aplica y ningun test obvio lo detecta). Nunca comparar contra la etiqueta.
 */
export const PRODUCT_CATEGORIES = ['Tecnologia', 'Hogar', 'Ropa'] as const;

/** Union cerrada derivada del arreglo: no se escribe a mano en ningun sitio. */
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** Unico lugar del monorepo donde vive la tilde de 'Tecnologia'. */
export const CATEGORY_LABEL: Record<ProductCategory, string> = {
  Tecnologia: 'Tecnología',
  Hogar: 'Hogar',
  Ropa: 'Ropa',
};
