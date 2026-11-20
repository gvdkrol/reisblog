import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { editorApi } from './scripts/editor-api.mjs';
import { tripsData } from './scripts/trips-data.mjs';
import { welkom } from './scripts/welkom.mjs';

export default defineConfig({
  // Relatieve paden, zodat de site werkt op https://<gebruiker>.github.io/<repo>/
  base: './',
  // De editor (/admin) en zijn API bestaan alleen tijdens `npm run dev`.
  plugins: [tripsData({ root: import.meta.dirname }), editorApi({ root: import.meta.dirname }), welkom({ root: import.meta.dirname })],
  build: {
    // De reisblog komt onder /reizen/ (achter Cloudflare Access); de openbare
    // welkomspagina zet scripts/welkom.mjs in dist/ zelf.
    outDir: 'dist/reizen',
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        trip: resolve(import.meta.dirname, 'trip.html'),
      },
    },
  },
});
