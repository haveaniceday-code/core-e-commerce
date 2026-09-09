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
    // `prisma-purchase.repository.ts` NO se excluye, a proposito (BC-R8.11). La
    // exclusion estaba condicionada a que el adaptador quedara sin ramas propias una vez
    // extraida la guarda del compare-and-swap a `verifyStockDecrements`, y no quedo:
    // la conversion de "sin cupon" a la columna NULL (`order.couponCode ?? null`) es una
    // rama. Es una frontera de representacion y no una decision de negocio, pero el
    // criterio del requisito es sintactico y se aplica tal cual: si tiene ramas, se mide.
  ],
  coverageThreshold: { global: { lines: 80, branches: 80 } },
};

export default config;
