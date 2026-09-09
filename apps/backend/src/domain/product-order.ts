import type { Product } from '@core/shared';

/** Comparador único del orden del catálogo. Los ids son ASCII, así que `localeCompare`
 *  sería innecesario y además dependiente del locale del proceso. */
export const compareProductId = (a: Product, b: Product): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export const sortByProductId = (products: readonly Product[]): readonly Product[] =>
  [...products].sort(compareProductId);
