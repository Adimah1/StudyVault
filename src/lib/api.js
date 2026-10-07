// Access point for the app backend: electron/preload.js on desktop, src/mobile/backend.js on mobile.
// A proxy so modules can import `sv` before the mobile backend has been installed on window.
export const sv = new Proxy({}, { get: (_, key) => window.sv?.[key] });

export const isMobile = () => window.sv?.platform === 'mobile';

/** Strip Electron's "Error invoking remote method ..." prefix from IPC errors. */
export function errorMessage(err) {
  const msg = (err && err.message) || String(err);
  return msg.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '');
}
