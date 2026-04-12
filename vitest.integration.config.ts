import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/integration/**/*.test.ts'],
    fileParallelism: false,
    globalSetup: ['src/integration/global-setup.ts'],
    testTimeout: 30000,
    server: {
      deps: {
        external: [/@fastify\/error/],
      },
    },
  },
});
