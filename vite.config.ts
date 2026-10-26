import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  root: '.',
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Keep Monaco (~3.5 MB, rarely changes) in its own chunk + stylesheet so
          // app-only deploys don't invalidate it, and its CSS loads before ours.
          groups: [{ name: 'monaco', test: /[\\/]node_modules[\\/]monaco-editor[\\/]/ }],
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
