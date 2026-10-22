// The taste's build (tools/build_demo.py): the web app exactly as frontend/
// builds it, with demo/app.html as its page instead of frontend/index.html,
// relative paths so it runs from any folder, and nothing from frontend/public
// (the taste brings its own icon).
import { fileURLToPath } from 'node:url';
import app from '../frontend/vite.config.js';

// The Svelte plugin asks Vite to find svelte from the project's root, which
// here is demo/, where there are no node_modules; every import of it comes
// from frontend/ anyway, where Vite finds it the ordinary way.
const fromFrontend = { name: 'moshe-demo-svelte-from-frontend', configResolved(c) { c.resolve.dedupe.splice(0); } };

// Themes kept out of the repository (frontend/src/lib/private-themes/) are
// the owner's alone: the public taste never carries them, even when built
// from a checkout that has some.
const noPrivateThemes = {
  name: 'moshe-demo-no-private-themes',
  enforce: 'pre',
  transform(code, id) { if (id.endsWith('/lib/themes-exchange.js')) return code.replace(/import\.meta\.glob\([^)]*\)/u, '{}'); },
};

export default {
  ...app,
  plugins: [noPrivateThemes, ...app.plugins, fromFrontend],
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: false,
  build: {
    ...app.build,
    outDir: process.env.MOSHE_DEMO_OUT || fileURLToPath(new URL('../frontend/dist-demo', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./app.html', import.meta.url)) },
  },
};
