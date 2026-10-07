import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ToastProvider } from './lib/toast.jsx';
import './index.css';

async function boot() {
  // Desktop: electron/preload.js has already exposed window.sv.
  // Mobile (Capacitor) / browser: install the in-app backend.
  if (!window.sv) {
    const { createMobileBackend } = await import('./mobile/backend.js');
    window.sv = await createMobileBackend();
  }
  document.documentElement.dataset.platform = window.sv.platform || 'desktop';

  // No <StrictMode>: its double-mounted effects make react-pdf load every PDF twice.
  ReactDOM.createRoot(document.getElementById('root')).render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  );
}

boot();
