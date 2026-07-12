import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      '{shared,server,web,desktop,examples}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
    ],
    exclude: ['acceptance/**', '**/node_modules/**', '**/dist/**'],
  },
});
