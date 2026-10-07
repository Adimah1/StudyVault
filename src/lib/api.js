// Thin access point for the preload bridge (see electron/preload.js).
export const sv = window.sv;

/** Strip Electron's "Error invoking remote method ..." prefix from IPC errors. */
export function errorMessage(err) {
  const msg = (err && err.message) || String(err);
  return msg.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '');
}
