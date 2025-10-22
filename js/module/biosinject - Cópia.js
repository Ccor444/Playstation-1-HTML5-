/*
  BIOS Injector Avançado + Notificação
  - Persiste BIOS no IndexedDB
  - Injeta automaticamente no storage do módulo
  - Notifica no modal se a BIOS foi localizada ou não
  - Timeout e retry inteligentes
*/

const DB_NAME = 'enge_bios_db_v3';
const STORE = 'bios_store';
const BIOS_KEY = 'bios-dtlh3000';
const BIOS_SIZE = 524288; // tamanho esperado da BIOS
const INJECT_RETRY = 300; // ms
const INJECT_TIMEOUT = 30000; // ms

// ------------------------------
// IndexedDB helpers
// ------------------------------
async function openDb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(tx.error);
  });
}

// ------------------------------
// UI / Notificações
// ------------------------------
function showBiosNotification(msg, duration = 2500) {
  const notif = document.getElementById('biosNotification');
  if (!notif) return;
  notif.textContent = msg;
  notif.classList.add('show');
  setTimeout(() => notif.classList.remove('show'), duration);
}

// Popula o input file com a BIOS
function populateFileInput(inputEl, bytes) {
  const file = new File([bytes], 'dtlh3000.bin', { type: 'application/octet-stream' });
  if (typeof DataTransfer !== 'undefined') {
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
  } else {
    Object.defineProperty(inputEl, 'files', { value: [file], configurable: true });
  }
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
}

// ------------------------------
// Injeta BIOS no módulo
// ------------------------------
function injectBios(arrayBuffer) {
  if (typeof window.writeStorageStream === 'function') {
    try {
      writeStorageStream('bios', arrayBuffer);
      console.log('[BIOS Injector] BIOS injetada no storage.');
      if (typeof window.bios === 'function') window.bios();
      return true;
    } catch (e) {
      console.warn('[BIOS Injector] Erro ao injetar BIOS:', e);
      return false;
    }
  }
  return false;
}

// ------------------------------
// Salva BIOS no IndexedDB
// ------------------------------
async function saveBios(arrayBuffer) {
  const bytes = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  await idbPut(BIOS_KEY, bytes);
  injectBios(arrayBuffer);
}

// ------------------------------
// Restaura BIOS ao carregar a página
// ------------------------------
async function restoreBios() {
  const saved = await idbGet(BIOS_KEY);
  const input = document.querySelector('#file input[type="file"]') || document.getElementById('file-upload');

  if (!saved) {
    showBiosNotification('Nenhuma BIOS encontrada');
    return;
  }

  const bytes = saved instanceof Uint8Array ? saved : new Uint8Array(saved);
  const ab = bytes.buffer;

  // Retry inteligente para injeção
  const startTime = Date.now();
  const tryInject = () => {
    if (injectBios(ab)) {
      showBiosNotification('BIOS localizada e injetada com sucesso');
      if (input) populateFileInput(input, bytes);
      return true;
    }
    if (Date.now() - startTime < INJECT_TIMEOUT) {
      setTimeout(tryInject, INJECT_RETRY);
    } else {
      showBiosNotification('Falha ao injetar BIOS após 30s');
    }
  };

  tryInject();
}

// ------------------------------
// Observa mudanças no input para salvar automaticamente
// ------------------------------
function attachInputHandler() {
  const input = document.querySelector('#file input[type="file"]') || document.getElementById('file-upload');
  if (!input || input.__biosHandlerAttached) return;
  input.__biosHandlerAttached = true;

  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ab = await file.arrayBuffer();
    const bytes = new Uint8Array(ab);

    if (bytes.length === BIOS_SIZE) {
      await saveBios(ab);
      console.log('[BIOS Injector] BIOS persistida e injetada automaticamente.');
      showBiosNotification('BIOS persistida e injetada automaticamente');
    } else {
      showBiosNotification('Arquivo selecionado não é uma BIOS válida');
    }
  });
}

// ------------------------------
// Inicialização
// ------------------------------
(function init() {
  const ready = () => {
    attachInputHandler();
    restoreBios();

    const fileDiv = document.getElementById('file');
    if (fileDiv) {
      new MutationObserver(() => attachInputHandler())
        .observe(fileDiv, { childList: true, subtree: true });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
