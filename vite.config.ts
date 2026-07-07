/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// Stamp the build with the current git commit. main.ts keeps this beside the
// saved scores and wipes them whenever it changes — every new push starts a
// fresh BEST ladder (see resetScoresOnNewVersion).
function gitVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(gitVersion()),
  },
  build: {
    target: 'esnext',
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
