import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: ['node_modules/**', 'src/integration/**'],
    server: {
      deps: {
        external: [/@fastify\/error/],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/plugins/**'],
      exclude: ['src/tests/**', 'src/integration/**'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
