import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@resto-hub\/design-system\/(styles|tokens|base|components|layout)\.css$/,
        replacement:
          fileURLToPath(new URL('../../packages/design-system/src/', import.meta.url)) +
          '$1.css',
      },
      {
        find: /^@resto-hub\/design-system$/,
        replacement: fileURLToPath(
          new URL('../../packages/design-system/src/index.ts', import.meta.url),
        ),
      },
    ],
  },
  server: {
    port: 5175,
    host: true,
  },
});
