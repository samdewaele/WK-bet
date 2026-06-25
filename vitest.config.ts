import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    clearMocks: true,
    include: ['__tests__/**/*.test.ts'],
    // These two tests require `prisma generate` (real Prisma client + SQLite DB).
    // Run them separately with `npm run test:integration`.
    exclude: ['__tests__/cleanup-sidebets.test.ts', '__tests__/ko-seeding.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@auth': path.resolve(__dirname, './auth'),
    },
  },
});