// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Mismo contrato de tipado que el resto de los workspaces (FC-R1.5, hereda MF-R2):
 * cero `any`, cero type assertions distintas de `as const` y cero comentarios `@ts-`.
 * Aplica tambien a los specs y a los dobles de prueba.
 *
 * `no-restricted-imports` cierra la otra mitad de FC-R1.3: `@core/shared` se consume por
 * su entry publico, nunca por rutas internas del paquete.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // `tsconfig.json` es el proyecto de verificacion: cubre `src/` y `vite.config.ts`.
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-expect-error': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      // Unica assertion permitida: `as const`. Estrecha, no ensancha.
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        {
          assertionStyle: 'never',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@core/shared/*'],
              message:
                '@core/shared se importa por su entry publico, nunca por rutas internas (FC-R1.3).',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', 'vite.config.ts', 'eslint.config.mjs'],
  },
);
