import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative URLs, so the built app works from any folder of a site (e.g. example.com/kplayer/).
  base: './',
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30000,
    // One worker at a time: each loads Verovio's WASM, and WSL here has little memory.
    maxWorkers: 1,
  },
});
