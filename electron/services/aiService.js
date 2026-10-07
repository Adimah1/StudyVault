'use strict';

// Desktop Gemini service. Runs in the main process so the API key never reaches the renderer.
// Prompts, retries, model fallback and error messages live in shared/ai-core.mjs (also used by mobile).
//
// Key resolution order:
//   1. Developer override saved from the hidden panel (Ctrl+Shift+D), stored in userData via electron-store
//   2. GEMINI_API_KEY from the .env file bundled with the app (resources/.env when packaged)
// Students never see or enter a key; every failure is reported with a friendly message.

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const Store = require('electron-store');

const FALLBACK_DEFAULT_MODEL = 'gemini-3.8-flash';

/* --------------------------------------------------------------- key handling */

function bundledEnvPath() {
  return app.isPackaged ? path.join(process.resourcesPath, '.env') : path.join(__dirname, '..', '..', '.env');
}

// .env is re-read whenever it changes on disk, so adding a key takes effect without a restart.
let envMtime = null;
function refreshEnv() {
  const file = bundledEnvPath();
  let mtime;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return;
  }
  if (mtime === envMtime) return;
  envMtime = mtime;
  require('dotenv').config({ path: file, override: true, quiet: true });
}

function init() {
  refreshEnv();
}

let store = null;
function devStore() {
  if (!store) store = new Store({ name: 'developer-settings', clearInvalidConfig: true });
  return store;
}

const cleanKey = (k) => {
  const key = String(k || '').trim();
  return key && key !== 'YOUR_KEY_HERE' ? key : null;
};

function overrideKey() {
  const saved = devStore().get('geminiApiKey');
  if (!saved) return null;
  try {
    if (saved.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(saved.slice(4), 'base64'));
    return saved.replace(/^raw:/, '');
  } catch {
    return null;
  }
}

function resolveKey() {
  refreshEnv();
  const override = cleanKey(overrideKey());
  if (override) return { key: override, source: 'override' };
  const bundled = cleanKey(process.env.GEMINI_API_KEY);
  if (bundled) return { key: bundled, source: 'bundled' };
  return { key: null, source: 'none' };
}

function model() {
  refreshEnv();
  return (process.env.GEMINI_MODEL || '').trim() || FALLBACK_DEFAULT_MODEL;
}

function setOverrideKey(key) {
  const k = cleanKey(key);
  if (!k) throw new Error('Enter a key.');
  const value = safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(k).toString('base64') : 'raw:' + k;
  devStore().set('geminiApiKey', value);
}

function clearOverrideKey() {
  devStore().delete('geminiApiKey');
}

/* ---------------------------------------------------------- shared AI core */

// Both shared/ai-core.mjs and @google/genai are ES modules, so they're loaded lazily.
let corePromise = null;
let core = null;
function getCore() {
  if (!corePromise) {
    corePromise = import('../../shared/ai-core.mjs').then((m) => {
      core = m.createAi({
        getKey: () => resolveKey().key,
        getModel: model,
        createClient: async (key) => {
          const { GoogleGenAI } = await import('@google/genai');
          return new GoogleGenAI({ apiKey: key });
        },
      });
      return core;
    });
  }
  return corePromise;
}

function activeModel() {
  return core ? core.activeModel() : model();
}

function status() {
  const { key, source } = resolveKey();
  return {
    available: !!key,
    source, // 'override' | 'bundled' | 'none'
    model: activeModel(),
    keyHint: key ? `…${key.slice(-4)}` : null,
    envFile: bundledEnvPath(),
  };
}

module.exports = {
  init,
  status,
  model,
  activeModel,
  setOverrideKey,
  clearOverrideKey,
  testKey: async (key) => (await getCore()).testKey(key),
  summarize: async (title, pages) => (await getCore()).summarize(title, pages),
  quiz: async (title, pages) => (await getCore()).quiz(title, pages),
  keyTerms: async (title, pages) => (await getCore()).keyTerms(title, pages),
  cardFromText: async (text) => (await getCore()).cardFromText(text),
};
