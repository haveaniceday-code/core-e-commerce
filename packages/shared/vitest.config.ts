import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // Sin tests descubiertos = fallo, nunca "aprobado" sobre cero pruebas (MF-R3.3)
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/**/*.types.ts', 'src/index.ts'],
      // Umbral del motor (DE-R6.1). El comando falla por debajo de 80.
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
