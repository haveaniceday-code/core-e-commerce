// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Hace cumplir MF-R2: cero `any`, cero type assertions distintas de `as const`,
 * cero comentarios `@ts-`, y cero importaciones de framework o de APIs de red / FS.
 * Se aplica tambien a los archivos de prueba y a los dobles (MF-R2.4).
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
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
      // Unica assertion permitida: `as const` (MF-R2.3). Estrecha, no ensancha.
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
              group: [
                '@nestjs/*',
                '@prisma/*',
                'prisma',
                'axios',
                'node-fetch',
                'express',
                'fs',
                'node:fs',
                'net',
                'node:net',
                'http',
                'node:http',
                'https',
                'node:https',
              ],
              message:
                'packages/shared es puro: sin framework, sin red, sin sistema de archivos (MF-R2.1).',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', 'vitest.config.ts', 'eslint.config.mjs'],
  },
);
