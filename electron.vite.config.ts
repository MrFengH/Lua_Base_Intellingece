import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';

const productionCspPlugin = (): Plugin => ({
  name: 'production-csp',
  transformIndexHtml: (html) => html.replace(' ws://localhost:*', ''),
});

export default defineConfig(({ command }) => ({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: resolve('dist/main') },
    resolve: { alias: { '@': resolve('src') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: resolve('dist/preload'),
      rollupOptions: { output: { format: 'cjs' } },
    },
    resolve: { alias: { '@': resolve('src') } },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: { outDir: resolve('dist/renderer') },
    resolve: { alias: { '@': resolve('src') } },
    plugins: [react(), ...(command === 'build' ? [productionCspPlugin()] : [])],
  },
}));
