import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 60000,
    setupFiles: ['./tests/setup.js'],
  },
});
