import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { editorApi } from './scripts/editor-api.mjs';
import { tripsData } from './scripts/trips-data.mjs';

export default defineConfig({
  // Relatieve paden, zodat de site werkt op https://<gebruiker>.github.io/<repo>/
  base: './',
  // De editor (/admin) en zijn API bestaan alleen tijdens `npm run dev`.
  plugins: [tripsData({ root: import.meta.dirname }), editorApi({ root: import.meta.dirname })],
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        trip: resolve(import.meta.dirname, 'trip.html'),
      },
    },
  },
});
