import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '\\.(spec|e2e-spec)\\.ts$',
  moduleNameMapper: {
    // Sigue siendo el entry público: apunta al index.ts, no a rutas internas.
    // Evita depender de un build previo de packages/shared para correr la suite.
    '^@core/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
  collectCoverageFrom: ['src/**/*.ts', 'prisma/seed.ts'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/main.ts', // bootstrap
    '<rootDir>/src/infra/prisma/prisma.service.ts', // provider Prisma
    '<rootDir>/src/infra/prisma/prisma-product.repository.ts', // adaptador Prisma
    '\\.spec\\.ts$',
  ],
  coverageThreshold: { global: { lines: 80, branches: 80 } },
};

export default config;
