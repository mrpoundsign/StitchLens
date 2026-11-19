import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base ensures GitHub Pages works under any repo name (and survives repo renames!)
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: 'index.html',
        app: 'app/index.html',
      },
    },
  },
  worker: {
    format: 'es',
  },
});
