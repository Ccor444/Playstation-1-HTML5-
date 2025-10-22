/*
  BIOS Injector Avançado + Notificação (versão atualizada)
  - Reaproveita conexão IndexedDB
  - Retry inteligente aguardando writeStorageStream via MutationObserver
  - Validação por tamanho + opcional hash SHA-256
  - Toast simples com fallback
  - Compatível com input file dinâmico
*/

const DB_NAME = 'enge_bios_db_v3';
const STORE = 'bios_store';
const BIOS_KEY = 'bios-dtlh3000';
const BIOS_SIZE = 524288; // tamanho esperado da BIOS
const INJECT_RETRY = 300; // ms
const INJECT_TIMEOUT = 30000; // ms (30s)
const BIOS_HASH_SHA256 = null; // opcional: hex SHA-256 da BIOS original. Ex: 'a1b2c3...'. null = desabilitado

// ------------------------------
// IndexedDB (conexão única)
// ------------------------------
let _dbInstance = null;
async function openDb() {
  if (_dbInstance) return _dbInstance;
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      try { req.result.createObjectStore(STORE); } catch (e) { /* já existe possivelmente */ }
    };
    req.onsuccess = () => {
      _dbInstance = req.result;
      res(_dbInstance);
    };
    req.onerror = () => rej(req.error || new Error('Erro opening IndexedDB'));
  });
}

async function idbPut(key, value) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const putReq = store.put(value, key);
    putReq.onsuccess = () => res();
    putReq.onerror = () => rej(putReq.error || tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const getReq = store.get(key);
    getReq.onsuccess = () => res(getReq.result);
    getReq.onerror = () => rej(getReq.error || tx.error);
  });
}

// ------------------------------
// Util: SHA-256 (Web Crypto) -> hex
// ------------------------------
async function sha256Hex(uint8array) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', uint8array);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ------------------------------
// UI / Notificações (toast simples)
// ------------------------------
function ensureBiosNotificationElement() {
  let el = document.getElementById('biosNotification');
  if (el) return el;

  // cria um toast simples no canto inferior direito
  el = document.createElement('div');
  el.id = 'biosNotification';
  el.style.position = 'fixed';
  el.style.right = '16px';
  el.style.bottom = '16px';
  el.style.zIndex = '9999';
  el.style.padding = '10px 14px';
  el.style.borderRadius = '8px';
  el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
  el.style.background = 'rgba(0,0,0,0.85)';
  el.style.color = '#fff';
  el.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
  el.style.fontSize = '14px';
  el.style.opacity = '0';
  el.style.transition = 'opacity 220ms ease';
  document.body.appendChild(el);
  return el;
}

function showBiosNotification(msg, duration = 2500) {
  const notif = ensureBiosNotificationElement();
  notif.textContent = msg;
  notif.style.opacity = '1';
  clearTimeout(notif._hideTimer);
  notif._hideTimer = setTimeout(() => {
    notif.style.opacity = '0';
  }, duration);
}

// ------------------------------
// Popula o input file com a BIOS
// ------------------------------
function populateFileInput(inputEl, bytes) {
  try {
    const file = new File([bytes], 'dtlh3000.bin', { type: 'application/octet-stream' });
    if (typeof DataTransfer !== 'undefined') {
      const dt = new DataTransfer();
      dt.items.add(file);
      inputEl.files = dt.files;
    } else {
      Object.defineProperty(inputEl, 'files', { value: [file], configurable: true });
    }
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (e) {
    console.warn('[BIOS Injector] populateFileInput failed:', e);
  }
}

// ------------------------------
// Injeta BIOS no módulo (com proteção)
// ------------------------------
function injectBios(arrayBuffer) {
  if (typeof window.writeStorageStream === 'function') {
    try {
      writeStorageStream('bios', arrayBuffer);
      console.log('[BIOS Injector] BIOS injetada no storage.');
      if (typeof window.bios === 'function') {
        try { window.bios(); } catch (e) { console.warn('[BIOS Injector] window.bios() erro:', e); }
      }
      return true;
    } catch (e) {
      console.warn('[BIOS Injector] Erro ao injetar BIOS:', e);
      return false;
    }
  }
  // se não existe writeStorageStream, retorna falso para o mecanismo de retry lidar
  return false;
}

// ------------------------------
// Salva BIOS no IndexedDB
// ------------------------------
async function saveBios(arrayBuffer) {
  const bytes = (arrayBuffer instanceof Uint8Array) ? arrayBuffer : new Uint8Array(arrayBuffer);
  await idbPut(BIOS_KEY, bytes);
  // tenta injetar imediatamente
  injectBios(arrayBuffer);
}

// ------------------------------
// Restaura BIOS ao carregar a página (retry inteligente)
// ------------------------------
async function restoreBios() {
  try {
    const saved = await idbGet(BIOS_KEY);
    const input = document.querySelector('#file input[type="file"]') || document.getElementById('file-upload');

    if (!saved) {
      showBiosNotification('Nenhuma BIOS encontrada');
      console.info('[BIOS Injector] Nenhuma BIOS encontrada no IndexedDB.');
      return;
    }

    const bytes = saved instanceof Uint8Array ? saved : new Uint8Array(saved);
    const ab = bytes.buffer;

    // validação de tamanho
    if (bytes.length !== BIOS_SIZE) {
      showBiosNotification('BIOS encontrada com tamanho inesperado');
      console.warn(`[BIOS Injector] Tamanho inesperado: ${bytes.length} (esperado ${BIOS_SIZE})`);
      // prossegue tentando injetar mesmo assim, caso queira tolerância
    } else if (BIOS_HASH_SHA256) {
      // valida hash opcional
      let ok = false;
      try {
        const hashHex = await sha256Hex(bytes);
        if (hashHex.toLowerCase() === BIOS_HASH_SHA256.toLowerCase()) {
          ok = true;
        } else {
          console.warn('[BIOS Injector] Hash mismatch:', hashHex);
          showBiosNotification('BIOS encontrada, mas hash diferente (possível cópia inválida)');
        }
      } catch (e) {
        console.warn('[BIOS Injector] Falha ao calcular hash SHA-256:', e);
      }
      if (!ok && BIOS_HASH_SHA256) {
        // ainda tenta injetar, mas avisa
        console.warn('[BIOS Injector] Continuando tentativa de injeção apesar do hash inválido.');
      }
    }

    // Retry inteligente: tenta injetar repetidas vezes até timeout.
    const startTime = Date.now();

    // Observador que detecta quando writeStorageStream aparece no window
    let releaseObserver = null;
    const ensureWriteStream = (cb) => {
      if (typeof window.writeStorageStream === 'function') {
        cb();
        return;
      }
      // observa mudanças no objeto global (adicionando props ao window)
      const mo = new MutationObserver(() => {
        if (typeof window.writeStorageStream === 'function') {
          mo.disconnect();
          releaseObserver = null;
          cb();
        }
      });
      releaseObserver = mo;
      // precisa de um alvo; usa <head> para monitorar adição de scripts que possam definir a função
      mo.observe(document.head || document.documentElement, { childList: true, subtree: true });
    };

    const tryInjectWithRetry = () => {
      if (injectBios(ab)) {
        showBiosNotification('BIOS localizada e injetada com sucesso');
        console.info('[BIOS Injector] BIOS injetada com sucesso.');
        if (input) populateFileInput(input, bytes);
        if (releaseObserver) {
          try { releaseObserver.disconnect(); } catch (e) {}
          releaseObserver = null;
        }
        return;
      }

      // se writeStorageStream não existe, vamos aguardar/observar
      if (typeof window.writeStorageStream !== 'function') {
        // observa e espera até que apareça, então chama tryInjectWithRetry (com timeout)
        ensureWriteStream(() => {
          // pequena espera para dar tempo à implementação de se estabilizar
          setTimeout(tryInjectWithRetry, 50);
        });
        // também define timeout geral
        if (Date.now() - startTime >= INJECT_TIMEOUT) {
          showBiosNotification('Falha ao injetar BIOS (timeout)');
          console.warn('[BIOS Injector] Timeout ao aguardar writeStorageStream');
        }
        return;
      }

      // se writeStorageStream existe mas injeção falhou, continua tentativas até timeout
      if (Date.now() - startTime < INJECT_TIMEOUT) {
        setTimeout(tryInjectWithRetry, INJECT_RETRY);
        return;
      } else {
        showBiosNotification('Falha ao injetar BIOS após 30s');
        console.warn('[BIOS Injector] Falha ao injetar BIOS após timeout');
      }
    };

    tryInjectWithRetry();
  } catch (e) {
    console.error('[BIOS Injector] restoreBios erro:', e);
    showBiosNotification('Erro ao restaurar BIOS (ver console)');
  }
}

// ------------------------------
// Observa mudanças no input para salvar automaticamente
// ------------------------------
function attachInputHandler() {
  const input = document.querySelector('#file input[type="file"]') || document.getElementById('file-upload');
  if (!input || input.__biosHandlerAttached) return;
  input.__biosHandlerAttached = true;

  input.addEventListener('change', async (e) => {
    try {
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
        console.warn(`[BIOS Injector] Arquivo inválido (tamanho ${bytes.length}). Esperado ${BIOS_SIZE}`);
      }
    } catch (err) {
      console.error('[BIOS Injector] Erro ao ler arquivo do input:', err);
      showBiosNotification('Erro ao processar arquivo (ver console)');
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
      // se o elemento #file for re-renderizado dinamicamente, reaplica o handler
      new MutationObserver(() => attachInputHandler())
        .observe(fileDiv, { childList: true, subtree: true });
    }

    // também tenta restaurar se o page becomes visible novamente (útil em PWA)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        restoreBios().catch(e => console.warn('[BIOS Injector] restoreBios on visibilitychange erro:', e));
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
