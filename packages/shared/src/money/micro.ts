/**
 * Escala y redondeo (SCS-R3.1 - SCS-R3.3).
 *
 * Toda la cascada opera en micro-centavos enteros. Se eligen enteros escalados
 * en `number` (y no bigint ni una libreria decimal) porque las divisiones de la
 * cascada son demostrablemente exactas: los denominadores acumulados de las tres
 * tasas son 10, 20 y 20, y su producto (4000) divide a 1.000.000.
 *
 * Estas funciones son PURAS y NO VALIDAN (SCS-R3.8): la validacion del carrito
 * vive en el motor, que si conoce el indice de linea y el productId.
 */

/** 1 centavo = 1.000.000 micro-centavos. */
export const MICRO = 1_000_000;

/** Cota de exactitud de la escala frente a Number.MAX_SAFE_INTEGER (~$90M). */
export const MAX_SUBTOTAL_CENTS = 9_000_000_000;

/** 100% = 10000 bps. */
export const BPS_DENOMINATOR = 10_000;

export const toMicros = (cents: number): number => cents * MICRO;

/**
 * Unico redondeo autorizado del sistema (DE-R4.1).
 * Todos los montos son positivos, asi que Math.round es half-up sin la
 * ambiguedad de signo que habria con negativos.
 */
export const roundHalfUp = (micros: number): number => Math.round(micros / MICRO);

/** Aplica una tasa entera en bps sobre un monto en micro-centavos. */
export const applyBps = (amountMicros: number, bps: number): number =>
  (amountMicros * bps) / BPS_DENOMINATOR;
