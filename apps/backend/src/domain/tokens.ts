/**
 * Tokens de inyeccion como literales `as const`. No importan NestJS: el dominio
 * declara el nombre del puerto, el modulo de infraestructura decide con que lo llena
 * (BP-R4.1, BP-R4.3).
 *
 * Se usan strings prefijados en lugar de simbolos porque los simbolos no sobreviven a un
 * `import type` accidental y el prefijo evita colisiones en el contenedor.
 */
export const PRODUCT_REPOSITORY = 'domain.ProductRepository' as const;

export const ORDER_REPOSITORY = 'domain.OrderRepository' as const;
