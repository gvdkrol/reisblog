import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Relatieve paden, zodat de site werkt op https://<gebruiker>.github.io/<repo>/
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        trip: resolve(import.meta.dirname, 'trip.html'),
      },
    },
  },
});
