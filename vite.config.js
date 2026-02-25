import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  server: {
    port: 5173,
    watch: {
      ignored: [
        '**/*.bak',
        '**/vite.config.js.timestamp-*.mjs',
      ],
    },
  },
});
