import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    // three.js tek başına ~600 kB (bölünemez); uygulama kodu ayrı parçada ~340 kB.
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        // Vite 8 (Rolldown): manualChunks kullanımdan kalktı, codeSplitting.groups kullanılır.
        // three (+ addons) ayrı bir vendor parçasına gider.
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\/]three[\/]/ }],
        },
      },
    },
  },
  test: {
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 60000,
    setupFiles: ['./tests/setup.js'],
  },
});
