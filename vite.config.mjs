import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer is a plain Vite + React app. Electron loads it from the dev
// server in development and from ./dist (via the app:// protocol) in production.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  // pdf.js ships top-level await; target Electron's Chromium so esbuild accepts it.
  optimizeDeps: {
    esbuildOptions: { target: 'chrome130' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
  },
});
