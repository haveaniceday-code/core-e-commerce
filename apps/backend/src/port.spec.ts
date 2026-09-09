import { DEFAULT_PORT, resolvePort } from './port';

/**
 * Invariante I1: `resolvePort` es total. Toda entrada que no represente un entero de puerto
 * valido devuelve exactamente `DEFAULT_PORT`, y toda salida cae en `1..65535`.
 *
 * Pruebas por ejemplo con tablas fijas, sin generadores aleatorios.
 *
 * Requisitos: BP-R1.3, BP-R6.3.
 */

const MIN_PORT = 1;
const MAX_PORT = 65535;

interface PortCase {
  /** Etiqueta legible para el nombre del caso: `undefined` y `''` no se leen solos. */
  readonly label: string;
  readonly raw: string | undefined;
  readonly expected: number;
}

/** Entradas que no representan un entero de puerto valido: todas caen al default. */
const FALLBACK_CASES: readonly PortCase[] = [
  { label: 'undefined (PORT no definido)', raw: undefined, expected: DEFAULT_PORT },
  { label: "'' (PORT vacio, Number('') es 0)", raw: '', expected: DEFAULT_PORT },
  { label: "'abc' (no numerico)", raw: 'abc', expected: DEFAULT_PORT },
  { label: "'3.5' (numerico pero no entero)", raw: '3.5', expected: DEFAULT_PORT },
  { label: "'-1' (negativo)", raw: '-1', expected: DEFAULT_PORT },
  { label: "'0' (frontera inferior excluida)", raw: '0', expected: DEFAULT_PORT },
  { label: "'65536' (frontera superior excluida)", raw: '65536', expected: DEFAULT_PORT },
  { label: "'70000' (fuera de rango)", raw: '70000', expected: DEFAULT_PORT },
];

/** Entradas validas: se devuelven tal cual, sin normalizar ni recortar. */
const VALID_CASES: readonly PortCase[] = [
  { label: "'8080' (el caso de uso habitual)", raw: '8080', expected: 8080 },
  { label: "'1' (frontera inferior incluida)", raw: '1', expected: MIN_PORT },
  { label: "'65535' (frontera superior incluida)", raw: '65535', expected: MAX_PORT },
  { label: "'3000' (coincide con el default)", raw: '3000', expected: DEFAULT_PORT },
];

const ALL_CASES: readonly PortCase[] = [...FALLBACK_CASES, ...VALID_CASES];

describe('resolvePort: entradas invalidas caen al default (I1, BP-R1.3)', () => {
  it.each([...FALLBACK_CASES])(
    'resuelve $label a DEFAULT_PORT',
    ({ raw, expected }: PortCase) => {
      expect(resolvePort(raw)).toBe(expected);
    },
  );
});

describe('resolvePort: entradas validas se respetan (I1, BP-R1.3)', () => {
  it.each([...VALID_CASES])('resuelve $label a $expected', ({ raw, expected }: PortCase) => {
    expect(resolvePort(raw)).toBe(expected);
  });
});

describe('resolvePort: totalidad y rango de salida (I1)', () => {
  it('DEFAULT_PORT es 3000', () => {
    expect(DEFAULT_PORT).toBe(3000);
  });

  it.each([...ALL_CASES])('la salida de $label es un entero en 1..65535', ({ raw }: PortCase) => {
    const port = resolvePort(raw);

    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThanOrEqual(MIN_PORT);
    expect(port).toBeLessThanOrEqual(MAX_PORT);
  });

  it('es determinista: dos llamadas con la misma entrada devuelven lo mismo', () => {
    expect(resolvePort('8080')).toBe(resolvePort('8080'));
    expect(resolvePort(undefined)).toBe(resolvePort(''));
  });
});
