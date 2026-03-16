import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: 'feishu-markdown',
        replacement: resolve(__dirname, '../feishu-markdown/src/index.ts'),
      },
      {
        find: '@',
        replacement: resolve(__dirname, '../feishu-markdown/src'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
