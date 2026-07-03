/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
