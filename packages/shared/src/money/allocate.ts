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
/**
 * Indices que reciben uno de los centavos sobrantes, en orden de mayor resto y
 * con desempate por menor indice.
 *
 * Se expone aparte para que un consumidor que ya recorre sus propias lineas
 * pueda aplicar el reparto sin volver a indexar un arreglo paralelo: indexar
 * bajo `noUncheckedIndexedAccess` obliga a una guarda `?? 0` inalcanzable, y una
 * rama inalcanzable es una rama que el umbral de cobertura no puede cubrir.
 */
export const largestRemainderWinners = (
  amountsMicros: readonly number[],
  targetCents: number,
): ReadonlySet<number> => {
  const leftover =
    targetCents - amountsMicros.reduce((acc, m) => acc + Math.floor(m / MICRO), 0);

  return new Set(
    amountsMicros
      .map((m, index) => ({ index, remainder: m % MICRO }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
      .slice(0, Math.max(leftover, 0))
      .map((e) => e.index),
  );
};

export const allocateByLargestRemainder = (
  amountsMicros: readonly number[],
  targetCents: number,
): number[] => {
  const winners = largestRemainderWinners(amountsMicros, targetCents);
  return amountsMicros.map(
    (m, index) => Math.floor(m / MICRO) + (winners.has(index) ? 1 : 0),
  );
};
