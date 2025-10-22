// enge-psx-ram-injector.js
// Substitui memRead/memWrite do MMU para permitir RAM maior (configurável).
// Uso: importar DEPOIS do bundle. Ex.: <script src="index.js"></script><script src="enge-psx-ram-injector.js"></script>

(function () {
  const DEFAULT = {
    newRamMB: 8,       // Total de RAM desejada (ex: 8 => 8MB). Deve ser múltiplo de 1MB.
    pollInterval: 80,  // Intervalo de polling para aguardar MMU pronto
    pollTimeout: 12000 // Timeout máximo em ms
  };
  let opts = Object.assign({}, DEFAULT);

  const L = (...args) => console.log('[PSX-RAM-INJ]', ...args);
  const W = (...args) => console.warn('[PSX-RAM-INJ]', ...args);
  const E = (...args) => console.error('[PSX-RAM-INJ]', ...args);

  // Gera máscara a partir do tamanho da RAM
  const maskFromBytes = sz => (sz - 1) >>> 0;

  // Garantir que nomes globais estejam presentes
  function ensureGlobalNames(found) {
    const names = [
      'map', 'map8', 'map16', 'ram', 'rom',
      'memRead8', 'memRead16', 'memRead32',
      'memWrite8', 'memWrite16', 'memWrite32',
      'psx', 'cpu', 'dma', 'rtc', 'spu', 'joy', 'cdr', 'gpu', 'mdc'
    ];
    for (const n of names) if (!found[n] && window[n]) found[n] = window[n];
    return found;
  }

  // Procura por exports do MMU
  function findExports() {
    const found = {};
    if (window.mmu && typeof window.mmu === 'object') {
      ['map', 'map8', 'map16', 'ram', 'rom', 'memRead8', 'memRead16', 'memRead32', 'memWrite8', 'memWrite16', 'memWrite32']
        .forEach(k => { if (k in window.mmu) found[k] = window.mmu[k]; });
    }
    return ensureGlobalNames(found);
  }

  // Cria implementações substitutas
  function makeReplacements(found, ramMask) {
    const newRamBytes = opts.newRamMB * 1024 * 1024 >>> 0;
    const baseBuffer = (found.map?.buffer) || (found.ram?.buffer) || null;

    if (!baseBuffer) { W('baseBuffer não encontrado — abortando replacement'); return false; }

    const ramView = new DataView(baseBuffer, 0, Math.max(newRamBytes, found.ram?.byteLength || 0));
    L('ramView criado com byteLength=', ramView.byteLength);

    const map8 = found.map8 || new Uint8Array(baseBuffer);
    const map16 = found.map16 || new Int16Array(baseBuffer);
    const map32 = found.map || new Int32Array(baseBuffer);

    const orig = {
      memRead8: found.memRead8,
      memRead16: found.memRead16,
      memRead32: found.memRead32,
      memWrite8: found.memWrite8,
      memWrite16: found.memWrite16,
      memWrite32: found.memWrite32
    };

    // === Funções de leitura ===
    function hwRead8(addr) {
      const reg = addr & 0x3fff;
      if (reg >= 0x1080 && reg < 0x1100) return window.dma?.rd08?.(reg) || 0;
      if (reg >= 0x1100 && reg < 0x1130) return window.rtc?.rd32?.(reg) || 0;
      if (reg >= 0x1C00 && reg < 0x2000) return !(reg & 1) ? window.spu?.getInt16?.(reg) : 0;

      switch (addr & 0x3fff) {
        case 0x1040: return window.joy?.rd08r1040?.() || 0;
        case 0x1044: return window.joy?.rd16r1044 ? (window.joy.rd16r1044() << 24) >> 24 : 0;
        case 0x1054: return 0;
        case 0x1060: return map8[addr >>> 0];
        case 0x1070: return window.cpu ? (window.cpu.istat << 24) >> 24 : 0;
        case 0x1800: return window.cdr?.rd08r1800?.() || 0;
        case 0x1801: return window.cdr?.rd08r1801?.() || 0;
        case 0x1802: return window.cdr?.rd08r1802?.() || 0;
        case 0x1803: return window.cdr?.rd08r1803?.() || 0;
        case 0x1814: return window.gpu?.rd32r1814?.() || 0;
        case 0x1824: return window.mdc?.rd32r1824?.() || 0;
        default:
          if (addr < 0x01801000 || addr >= 0x01802000) return map8[addr >>> 0];
      }
      return 0;
    }

    function new_memRead8(base) {
      if (base < 0x00800000) {
        window.psx && (window.psx.clock = (window.psx.clock || 0) + 2);
        return ramView.getInt8(base & ramMask);
      }
      if (base >= 0x01800000 && base < 0x01803000) return (hwRead8(base) << 24) >> 24;
      if (base >= 0x01A00000 && base < 0x01A80000) {
        window.psx && (window.psx.clock += 5);
        return map8[base >>> 0];
      }
      if (base >= 0x01C00000 && base < 0x01C80000) {
        window.psx && (window.psx.clock += 8);
        return map8[base >>> 0];
      }
      if (base >= 0x01000000 && base < 0x01080000) {
        window.psx && (window.psx.clock += 6);
        return map8[base >>> 0];
      }
      if (base === 0x01fe0130) return map8[base >>> 0];
      return orig.memRead8 ? orig.memRead8(base) : (W('new_memRead8: endereço inválido', base.toString(16)), 0);
    }

    // === Funções de escrita ===
    function hwWrite8(addr, data) {
      const reg = addr & 0x3fff;
      if (reg >= 0x1080 && reg < 0x1100) { window.dma?.wr08?.(reg, data); return; }
      switch (addr & 0x3fff) {
        case 0x1040: window.joy?.wr08r1040?.(data); return;
        case 0x1800: window.cdr?.wr08r1800?.(data); return;
        case 0x1801: window.cdr?.wr08r1801?.(data); return;
        case 0x1802: window.cdr?.wr08r1802?.(data); return;
        case 0x1803: window.cdr?.wr08r1803?.(data); return;
      }
      W('hwWrite8: reg não tratado', addr.toString(16));
    }

    function new_memWrite8(base, data) {
      if (base < 0x00800000) {
        const addr = base & ramMask;
        map8[(addr | window.cpu?.forceWriteBits || 0) >>> 0] = data;
        try { window.fastCache && (window.fastCache[addr] = 0); } catch (e) {}
        return;
      }
      if (base >= 0x01800000 && base < 0x01802000) {
        map8[base >>> 0] = data;
        if (base >= 0x01801000) hwWrite8(base, data);
        return;
      }
      if (base === 0x1802041) { map8[base >>> 0] = data; return; }
      return orig.memWrite8?.(base, data) || W('new_memWrite8: endereço inválido', base.toString(16));
    }

    // === Instala replacements globalmente ===
    try {
      window.memRead8 = new_memRead8;
      window.memRead16 = orig.memRead16; // Adapte as outras como memRead16/32/Write16/32 se necessário
      window.memRead32 = orig.memRead32;
      window.memWrite8 = new_memWrite8;
      window.memWrite16 = orig.memWrite16;
      window.memWrite32 = orig.memWrite32;

      window.ram = ramView;
      L('memRead/memWrite substituídos — RAM virtual agora usa máscara:', '0x' + ramMask.toString(16), `(${opts.newRamMB}MB)`);

      window.__PSX_RAM_INJECTOR__ = { installed: true, newRamMB: opts.newRamMB, ramMask };
      return true;
    } catch (e) { E('Falha ao instalar replacements', e); return false; }
  }

  // Polling para esperar MMU estar pronto
  function poll() {
    const start = performance.now();
    const id = setInterval(() => {
      if (performance.now() - start > opts.pollTimeout) { clearInterval(id); W('timeout — não encontrou MMU exports.'); return; }
      const found = findExports();
      if ((found.map?.buffer) || found.ram) {
        clearInterval(id);
        const ramMask = maskFromBytes(opts.newRamMB * 1024 * 1024);
        L('found MMU exports — applying replacements with mask 0x' + ramMask.toString(16));
        makeReplacements(found, ramMask) || W('replace failed');
      } else {
        L('aguardando exposição de MMU (map/ram) ...');
      }
    }, opts.pollInterval);
  }

  // API pública
  window.PSXInjectorRAM = {
    configure: (o = {}) => { opts = Object.assign(opts, o); L('config updated', opts); },
    run: () => poll(),
    restore: () => { L('restore: recarregue a página para reverter completamente.'); }
  };

  L('PSX RAM Injector carregado — iniciando poll...');
  setTimeout(poll, 20);
})();