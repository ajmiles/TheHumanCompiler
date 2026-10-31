import { defineConfig } from 'vite';

// The hardware verifier: src/hardware/verifier.ts becomes dist/hw/verifier.js, a classic script that defines the
// global HumanCompilerVerifier for the devkit title to run in QuickJS. npm run build runs this after the app's build,
// into the same dist/ (so the site serves it at hw/verifier.js).
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/hw',
    emptyOutDir: false,
    sourcemap: false,
    target: 'es2020',
    lib: {
      entry: 'src/hardware/verifier.ts',
      name: 'HumanCompilerVerifier',
      formats: ['iife'],
      fileName: () => 'verifier.js',
    },
  },
});
