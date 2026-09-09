/**
 * Punto de entrada publico de @core/shared (SCS-R1.7).
 * Los consumidores importan desde aqui y nunca desde rutas internas.
 */

// Contratos del dominio
export { PRODUCT_CATEGORIES, CATEGORY_LABEL } from './domain/categories';
export type { ProductCategory } from './domain/categories';
export type { Product, CartItem } from './domain/product';
export { COUPON_STATUSES } from './domain/coupon';
export type { Coupon, CouponStatus } from './domain/coupon';
export { DISCOUNT_NAMES } from './domain/discount.contracts';
export type {
  DiscountName,
  DiscountLine,
  CheckoutTotals,
} from './domain/discount.contracts';
export { ERROR_CODES } from './domain/errors';
export type { ErrorCode, ApiError } from './domain/errors';

// Seed canonico
export { CATALOG_PRODUCTS, findProductById } from './seed/catalog.seed';
export { COUPONS, findCouponByCode } from './seed/coupons.seed';

// Utilidades de dinero
export { MICRO, MAX_SUBTOTAL_CENTS, BPS_DENOMINATOR, toMicros, roundHalfUp, applyBps } from './money/micro';
export { allocateByLargestRemainder } from './money/allocate';
export { formatCents } from './money/format';

// Errores del dominio
export { DiscountDomainError, isDiscountDomainError } from './domain/errors';

// Motor de descuentos
export type {
  DiscountStrategy,
  DiscountContext,
  DiscountResult,
  ResolvedCartLine,
} from './discount/discount.types';
export type { DiscountCalculationInput } from './discount/cart-resolver';
export { DISCOUNT_LABEL } from './discount/discount.labels';
export { CategoryDiscount } from './discount/strategies/category.discount';
export { VolumeDiscount, VOLUME_THRESHOLD_CENTS } from './discount/strategies/volume.discount';
export { CouponDiscount } from './discount/strategies/coupon.discount';
export { DiscountStrategyFactory } from './discount/discount-strategy.factory';
export { DiscountEngine } from './discount/discount-engine';
export { CAP_BPS } from './discount/totals-assembler';
