import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// One React app, two hosts:
//   - Desktop: Electron loads it from the dev server / ./dist (window.sv comes from electron/preload.js)
//   - Mobile:  `vite build --mode mobile` → ./dist-mobile, wrapped by Capacitor (window.sv from src/mobile)
export default defineConfig(({ mode }) => {
  const mobile = mode === 'mobile';
  // Only the mobile bundle gets the Gemini key (desktop keeps it in the main process).
  const env = mobile ? loadEnv(mode, process.cwd(), '') : {};
  const clean = (v) => (v && v.trim() !== 'YOUR_KEY_HERE' ? v.trim() : '');

  return {
    plugins: [react()],
    base: './',
    define: {
      __SV_GEMINI_KEY__: JSON.stringify(mobile ? clean(env.GEMINI_API_KEY) : ''),
      __SV_GEMINI_MODEL__: JSON.stringify(mobile ? (env.GEMINI_MODEL || '').trim() : ''),
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    // pdf.js ships top-level await; target Electron's Chromium / modern Android WebView.
    optimizeDeps: {
      esbuildOptions: { target: 'chrome130' },
    },
    build: {
      outDir: mobile ? 'dist-mobile' : 'dist',
      emptyOutDir: true,
      target: mobile ? 'chrome111' : 'chrome130',
    },
  };
});
