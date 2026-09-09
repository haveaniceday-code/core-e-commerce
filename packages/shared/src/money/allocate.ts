import { MICRO } from './micro';

/**
 * Reparto por mayor resto (SCS-R3.5 - SCS-R3.7).
 *
 * Reparte `targetCents` entre las posiciones de `amountsMicros` de modo que la
 * suma del resultado sea exactamente `targetCents`:
 *   - parte del piso Math.floor(m / MICRO) de cada posicion,
 *   - asigna un centavo por vez a las posiciones de mayor resto (m mod MICRO),
 *   - ante restos iguales gana la posicion de MENOR INDICE (determinismo).
 *
 * Con las estrategias del factory el orden de indice es exactamente el orden de
 * precedencia CATEGORY, VOLUME, COUPON.
 *
 * Funcion pura: no muta la entrada y no valida (SCS-R3.8).
 */
export const allocateByLargestRemainder = (
  amountsMicros: readonly number[],
  targetCents: number,
): number[] => {
  const floors = amountsMicros.map((m) => Math.floor(m / MICRO));
  const leftover = targetCents - floors.reduce((acc, c) => acc + c, 0);

  // Mayor resto primero; ante empate, menor indice primero.
  const winners = new Set(
    amountsMicros
      .map((m, index) => ({ index, remainder: m % MICRO }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
      .slice(0, Math.max(leftover, 0))
      .map((e) => e.index),
  );

  return floors.map((floor, index) => (winners.has(index) ? floor + 1 : floor));
};
