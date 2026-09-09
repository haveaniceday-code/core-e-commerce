/** Puerto por defecto cuando `PORT` no esta definido o no es utilizable (BP-R1.3). */
export const DEFAULT_PORT = 3000;

const MAX_PORT = 65535;

/**
 * Total por construccion: cualquier entrada que no represente un entero de puerto valido
 * cae en `DEFAULT_PORT`, y toda salida queda en `1..65535` (BP-R1.3).
 *
 * No necesita ramas especiales para los casos degenerados: `Number('')` es `0` y
 * `Number('3.5')` no es entero, asi que ambos los descarta la misma condicion. La funcion
 * vive fuera de `main.ts` porque el bootstrap esta excluido de la medicion de cobertura y
 * esta resolucion si tiene ramas que merecen prueba.
 */
export const resolvePort = (raw: string | undefined): number => {
  if (raw === undefined) return DEFAULT_PORT;

  const parsed = Number(raw);

  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_PORT ? parsed : DEFAULT_PORT;
};
