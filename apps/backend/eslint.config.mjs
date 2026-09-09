// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Tipado estricto del backend: cero `any`, cero type assertions distintas de `as const`
 * y cero comentarios `@ts-`. Aplica tambien a `test/` y a los dobles de prueba.
 *
 * El segundo bloque impone la pureza de la capa de dominio (R4.3) con
 * `no-restricted-imports` acotado a `src/domain/**`: falla antes y mas barato que una
 * prueba de arquitectura que recorra imports en runtime.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // `tsconfig.json` es el proyecto de verificacion: incluye `src/`, `test/` y
        // `prisma/`, que es exactamente lo que el linter necesita tipar.
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
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client', '@nestjs/*', 'express'],
              message: 'El dominio no conoce el framework ni la persistencia (R4.3).',
            },
            {
              group: ['**/infra/**', '**/http/**'],
              message: 'El dominio no depende de sus adaptadores (R4.3).',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', 'jest.config.ts', 'eslint.config.mjs'],
  },
);
