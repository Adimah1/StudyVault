'use strict';

// The only bridge between the sandboxed renderer and Node/Electron.
// Everything is request/response over IPC; file access is by library id, never by raw path.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('sv', {
  platform: 'desktop',
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  library: {
    chooseFolder: () => invoke('library:chooseFolder'),
    scan: () => invoke('library:scan'),
    list: () => invoke('library:list'),
    onScanProgress: (cb) => {
      const listener = (_event, data) => cb(data);
      ipcRenderer.on('scan:progress', listener);
      return () => ipcRenderer.removeListener('scan:progress', listener);
    },
  },
  file: {
    content: (id) => invoke('file:content', id),
    readBinary: (id) => invoke('file:readBinary', id),
    openExternal: (id) => invoke('file:openExternal', id),
    reveal: (id) => invoke('file:reveal', id),
  },
  notes: {
    get: (fileId) => invoke('notes:get', fileId),
    save: (fileId, html) => invoke('notes:save', fileId, html),
  },
  progress: {
    tick: (fileId, seconds) => invoke('progress:tick', fileId, seconds),
    scroll: (fileId, data) => invoke('progress:scroll', fileId, data),
  },
  search: {
    query: (q) => invoke('search:query', q),
  },
  cards: {
    list: (opts) => invoke('cards:list', opts),
    due: (opts) => invoke('cards:due', opts),
    stats: (opts) => invoke('cards:stats', opts),
    create: (cardOrCards) => invoke('cards:create', cardOrCards),
    update: (id, patch) => invoke('cards:update', id, patch),
    delete: (id) => invoke('cards:delete', id),
    review: (id, grade) => invoke('cards:review', id, grade),
  },
  ai: {
    summary: (fileId, opts) => invoke('ai:summary', fileId, opts),
    quiz: (fileId, opts) => invoke('ai:quiz', fileId, opts),
    keyTerms: (fileId) => invoke('ai:keyTerms', fileId),
    cardFromText: (text) => invoke('ai:cardFromText', text),
  },
  // Hidden developer panel only (Ctrl+Shift+D).
  dev: {
    aiStatus: () => invoke('dev:aiStatus'),
    testKey: (key) => invoke('dev:testKey', key),
    setKey: (key) => invoke('dev:setKey', key),
    clearKey: () => invoke('dev:clearKey'),
  },
});
