import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('./src/board/ui', import.meta.url));
const outDir = fileURLToPath(new URL('./dist/board-ui', import.meta.url));

export default defineConfig({
  root,
  base: '/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4310',
    },
  },
});
