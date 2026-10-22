import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

// The page runs the engine itself (../engine): the library, the markup, the merge.
const engine = fileURLToPath(new URL('../engine/src', import.meta.url));
// the exporters; MOSHE_EXPORT_STUB builds without them (while they are being written)
const exporter = process.env.MOSHE_EXPORT_STUB
  ? fileURLToPath(new URL('./src/lib/export-stub.js', import.meta.url))
  : fileURLToPath(new URL('../engine/src/export/index.js', import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  base: '/',
  resolve: {
    alias: [
      ...(process.env.MOSHE_IMPORT_STUB ? [{ find: '@engine/import/index.js', replacement: fileURLToPath(new URL('./src/lib/import-stub.js', import.meta.url)) }] : []),
      { find: '@export', replacement: exporter },
      // Hspell's dictionary: its package offers only a loader for Node, the files are what the page needs
      { find: '@he-dictionary', replacement: fileURLToPath(new URL('./node_modules/dictionary-he', import.meta.url)) },
      { find: '@engine', replacement: engine },
    ],
  },
  // Hebrew spelling's worker (editor/hebrew-worker.js) is a module: Hunspell's loader needs import.meta
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 1500 },
  server: { port: 5173, fs: { allow: ['..'] }, proxy: { '/api': { target: 'http://localhost:8430', changeOrigin: true } } },
});
