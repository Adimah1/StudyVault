// Minimal promise wrapper around IndexedDB (the mobile app's local database).

const DB_NAME = 'studyvault';
const VERSION = 1;

let dbPromise = null;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('cards', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('reviews', { autoIncrement: true });
        // Keyed by file id (or a string key for aiCache/settings)
        for (const name of ['blobs', 'pages', 'html', 'notes', 'progress', 'aiCache', 'settings']) db.createObjectStore(name);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const done = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function store(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

export const idb = {
  get: async (name, key) => done((await store(name)).get(key)),
  getAll: async (name) => done((await store(name)).getAll()),
  /** put(value) for keyPath stores, put(value, key) for keyed stores. Returns the key. */
  put: async (name, value, key) => done((await store(name, 'readwrite')).put(value, key)),
  add: async (name, value) => done((await store(name, 'readwrite')).add(value)),
  delete: async (name, key) => done((await store(name, 'readwrite')).delete(key)),
};
