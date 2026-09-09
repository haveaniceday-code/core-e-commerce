import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Un solo archivo concentra las cuatro decisiones de infraestructura del frontend:
 * plugin de React, alias a las fuentes de `@core/shared`, proxy de `/api` y Vitest.
 *
 * `defineConfig` se importa de `vitest/config` y no de `vite`, porque es la que tipa el
 * bloque `test`. Vitest vive aqui y no en un `vitest.config.ts` aparte (D-config): un
 * segundo archivo seria un segundo sitio donde el alias y el entorno se desincronizan, y
 * el alias es justamente lo que hace que los tests vean los mismos tipos que el bundler.
 */

// Ruta al entry publico de shared. Se deriva de `import.meta.url` en vez de `__dirname`
// porque el paquete es ESM (`"type": "module"`) y no existe `__dirname` en ese contexto.
const SHARED_ENTRY = fileURLToPath(
  new URL('../../packages/shared/src/index.ts', import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    // FC-R1.3: se resuelve a las FUENTES, no a `dist/`. `dev`, `test` y `typecheck` no
    // dependen de un build previo de shared, y el alias espeja `paths` de tsconfig.json.
    alias: {
      '@core/shared': SHARED_ENTRY,
    },
  },
  server: {
    // FC-R1.4: el navegador pide `/api` al propio origen de Vite y el dev server reenvia
    // al backend. Sin peticiones de origen cruzado, asi que nada de CORS que configurar.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    // FC-R6.1: React Testing Library necesita DOM; no hay servidor real ni base de datos.
    // Sin `globals`: los specs importan `describe`/`it`/`expect` de 'vitest', para que el
    // typecheck del workspace no dependa de tipos globales inyectados.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    // Sin tests descubiertos = fallo, nunca "aprobado" sobre cero pruebas.
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // `main.tsx` solo monta React: no tiene ramas y su inclusion solo diluiria el
      // porcentaje. Los specs y el setup tampoco son codigo bajo prueba.
      exclude: ['src/main.tsx', 'src/test/**', '**/*.spec.{ts,tsx}'],
      // FC-R6.6: medir no basta, el comando debe FALLAR por debajo de 80.
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
