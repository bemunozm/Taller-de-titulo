module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  // Trinquete (Fase 4 · P8.C): nivel medido el 2026-10-09 menos ~2 puntos
  // (statements 52.7, branches 48.9, functions 48.8, lines 53.7). Solo se
  // evalúa con `npm run test:coverage` (lo corre CI). Súbelo cuando suba la
  // cobertura; no lo bajes para que pase un cambio.
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 46,
      functions: 46,
      lines: 51,
    },
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
  testTimeout: 10000,
};
