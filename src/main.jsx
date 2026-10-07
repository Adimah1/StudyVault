import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ToastProvider } from './lib/toast.jsx';
import './index.css';

// No <StrictMode>: its double-mounted effects make react-pdf load every PDF twice.
ReactDOM.createRoot(document.getElementById('root')).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
