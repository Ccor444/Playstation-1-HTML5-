// enge-psx-ram-injector.js
// Substitui memRead/memWrite do mmu para permitir RAM maior (configurável).
// Uso: importar DEPOIS do bundle. Ex.: <script src="index.js"></script><script src="enge-psx-ram-injector.js"></script>

(function(){
  const DEFAULT = {
    newRamMB: 8,            // total de RAM desejada (ex: 8 => 8MB). Deve ser múltiplo até 8MB razoavelmente.
    pollInterval: 80,
    pollTimeout: 12000
  };
  let opts = Object.assign({}, DEFAULT);

  const L = (...a) => console.log('[PSX-RAM-INJ]', ...a);
  const W = (...a) => console.warn('[PSX-RAM-INJ]', ...a);
  const E = (...a) => console.error('[PSX-RAM-INJ]', ...a);

  // Helper: cria máscara a partir do tamanho (power-of-two)
  function maskFromBytes(sz) {
    // retorna máscara (ex: 8MB -> 0x7FFFFF)
    return (sz - 1) >>> 0;
  }

  function ensureGlobalNames(found) {
    // Alguns nomes que usaremos (heurística)
    const names = ['map','map8','map16','ram','rom','memRead8','memRead16','memRead32','memWrite8','memWrite16','memWrite32','psx','cpu','dma','rtc','spu','joy','cdr','gpu','mdc','mdc'];
    for (const n of names) {
      if (!found[n] && window[n]) found[n] = window[n];
    }
    return found;
  }

  function findExports() {
    const found = {};
    // se o mmu foi exportado como objeto, copiar referências
    if (window.mmu && typeof window.mmu === 'object') {
      // copia propriedades relevantes se existirem
      ['map','map8','map16','ram','rom','memRead8','memRead16','memRead32','memWrite8','memWrite16','memWrite32'].forEach(k => {
        if (k in window.mmu) found[k] = window.mmu[k];
      });
    }
    // também pegar propriedades diretas no global (Object.assign earlier)
    ['map','map8','map16','ram','rom','memRead8','memRead16','memRead32','memWrite8','memWrite16','memWrite32'].forEach(k => {
      if (!found[k] && window[k]) found[k] = window[k];
    });
    // fill hardware modules if present
    ['psx','cpu','dma','rtc','spu','joy','cdr','gpu','mdc'].forEach(k => {
      if (window[k] && !found[k]) found[k] = window[k];
    });
    return ensureGlobalNames(found);
  }

  // Funções substitutas: reimplementam a lógica do mmu.js mas com nova máscara para RAM
  function makeReplacements(found, ramMask) {
    const newRamBytes = (opts.newRamMB * 1024 * 1024) >>> 0;
    // We'll use the existing map buffer & views (map/map8/map16) and a new DataView 'ramView' that covers newRamBytes
    const baseBuffer = (found.map && found.map.buffer) ? found.map.buffer : (found.ram && found.ram.buffer ? found.ram.buffer : null);
    if (!baseBuffer) { W('baseBuffer não encontrado — abortando replacement'); return false; }

    // create a DataView that covers at least newRamBytes
    const ramView = new DataView(baseBuffer, 0, Math.max(newRamBytes, (found.ram ? found.ram.byteLength : 0)));
    L('ramView criado com byteLength=', ramView.byteLength);

    // helper to read/write via map8/map16/map
    const map8 = found.map8 || new Uint8Array(baseBuffer);
    const map16 = found.map16 || new Int16Array(baseBuffer);
    const map32 = found.map || new Int32Array(baseBuffer);

    // keep references to original functions (if any)
    const orig = {
      memRead8: found.memRead8,
      memRead16: found.memRead16,
      memRead32: found.memRead32,
      memWrite8: found.memWrite8,
      memWrite16: found.memWrite16,
      memWrite32: found.memWrite32
    };

    // Implementações baseadas no mmu.js logic you supplied
    function hwRead8(addr) {
      const reg = addr & 0x3fff;
      // hardware handlers from globals
      if (reg >= 0x1080 && reg < 0x1100) return window.dma && window.dma.rd08 ? window.dma.rd08(reg) : 0;
      if (reg >= 0x1100 && reg < 0x1130) return window.rtc && window.rtc.rd32 ? window.rtc.rd32(reg) : 0;
      if (reg >= 0x1C00 && reg < 0x2000) {
        return !(reg & 1) && window.spu && window.spu.getInt16 ? window.spu.getInt16(reg) : 0;
      }
      switch (addr & 0x3fff) {
        case 0x1040: return window.joy && window.joy.rd08r1040 ? window.joy.rd08r1040() : 0;
        case 0x1044: return window.joy && window.joy.rd16r1044 ? (window.joy.rd16r1044() << 24) >> 24 : 0;
        case 0x1054: return 0;
        case 0x1060: return map8[addr >>> 0] >> 0;
        case 0x1070: return window.cpu ? (window.cpu.istat << 24) >> 24 : 0;
        case 0x1800: return window.cdr && window.cdr.rd08r1800 ? window.cdr.rd08r1800() : 0;
        case 0x1801: return window.cdr && window.cdr.rd08r1801 ? window.cdr.rd08r1801() : 0;
        case 0x1802: return window.cdr && window.cdr.rd08r1802 ? window.cdr.rd08r1802() : 0;
        case 0x1803: return window.cdr && window.cdr.rd08r1803 ? window.cdr.rd08r1803() : 0;
        case 0x1814: return window.gpu && window.gpu.rd32r1814 ? window.gpu.rd32r1814() : 0;
        case 0x1824: return window.mdc && window.mdc.rd32r1824 ? window.mdc.rd32r1824() : 0;
        default:
          if (addr < 0x01801000) {
            return map8[addr >>> 0];
          }
          if (addr >= 0x01802000) {
            return map8[addr >>> 0];
          }
      }
      return 0;
    }

    function new_memRead8(base) {
      // main RAM region: base < 0x00800000
      if (base < 0x00800000) {
        // psx.clock adjust as original
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 2;
        const idx = base & ramMask;
        return ramView.getInt8(idx);
      }
      if ((base >= 0x01800000) && (base < 0x01803000)) {
        return (hwRead8(base) << 24) >> 24;
      }
      if (base >= 0x01A00000 && base < 0x01A80000) {
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 5;
        return map8[base >>> 0] >> 0;
      }
      if (base >= 0x01C00000 && base < 0x01C80000) {
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 8;
        return map8[base >>> 0] >> 0;
      }
      if (base >= 0x01000000 && base < 0x01080000) {
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 6;
        return map8[base >>> 0] >> 0;
      }
      if (base === 0x01fe0130) {
        return map8[base >>> 0] >> 0;
      }
      // fallback to original if exists
      if (orig.memRead8) return orig.memRead8(base);
      // else throw/log
      W('new_memRead8: endereço inválido', base.toString(16));
      return 0;
    }

    function hwRead16(addr) {
      const reg = addr & 0x3fff;
      if (reg >= 0x1080 && reg < 0x1100) return window.dma && window.dma.rd16 ? window.dma.rd16(reg) : 0;
      if (reg >= 0x1100 && reg < 0x1130) return window.rtc && window.rtc.rd32 ? window.rtc.rd32(reg) : 0;
      if (reg >= 0x1C00 && reg < 0x2000) return window.spu && window.spu.getInt16 ? window.spu.getInt16(reg) : 0;
      switch (addr & 0x3fff) {
        case 0x1014: return map16[addr >>> 1];
        case 0x1044: return window.joy && window.joy.rd16r1044 ? window.joy.rd16r1044() : 0;
        case 0x104a: return window.joy && window.joy.rd16r104a ? window.joy.rd16r104a() : 0;
        case 0x104e: return window.joy && window.joy.rd16r104e ? window.joy.rd16r104e() : 0;
        case 0x1054: return 0x00;
        case 0x105a: return 0;
        case 0x105e: return 0;
        case 0x1060: return map16[addr >>> 1] >> 0;
        case 0x1070: return window.cpu ? window.cpu.istat : 0;
        case 0x1074: return window.cpu ? window.cpu.imask : 0;
        case 0x1130: return 0;
        case 0x1800: return window.cdr && window.cdr.rd08r1800 ? window.cdr.rd08r1800() : 0;
        case 0x1814: return window.gpu && window.gpu.rd32r1814 ? window.gpu.rd32r1814() : 0;
        case 0x1824: return window.mdc && window.mdc.rd32r1824 ? window.mdc.rd32r1824() : 0;
        default:
          if (addr < 0x01801000) {
            return map16[addr >>> 1];
          }
          if (addr >= 0x01802000) {
            return map16[addr >>> 1];
          }
      }
      return 0;
    }

    function new_memRead16(base) {
      if (base < 0x00800000) {
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 3;
        return ramView.getInt16(base & ramMask, true);
      }
      if ((base >= 0x01800000) && (base < 0x01803000)) {
        return (hwRead16(base) << 16) >> 16;
      }
      if (base >= 0x01A00000 && base < 0x01A80000) {
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 5;
        return map16[base >>> 1] >> 0;
      }
      if (base >= 0x01C00000 && base < 0x01C80000) {
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 12;
        return map16[base >>> 1];
      }
      if (base >= 0x01000000 && base < 0x01080000) {
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 12;
        return map16[base >>> 1];
      }
      if (base === 0x01fe0130) {
        return map16[base >>> 1] >> 0;
      }
      if (orig.memRead16) return orig.memRead16(base);
      W('new_memRead16: endereço inválido', base.toString(16));
      return 0;
    }

    function hwRead32(addr) {
      const reg = addr & 0x3fff;
      if (reg >= 0x1080 && reg < 0x1100) return window.dma && window.dma.rd32 ? window.dma.rd32(reg) : 0;
      if (reg >= 0x1100 && reg < 0x1130) return window.rtc && window.rtc.rd32 ? window.rtc.rd32(reg) : 0;
      switch (addr & 0x3fff) {
        case 0x1014: return map32[addr >>> 2] >> 0;
        case 0x1020: return map32[addr >>> 2] >> 0;
        case 0x1044: return window.joy && window.joy.rd16r1044 ? window.joy.rd16r1044() >> 0 : 0;
        case 0x1054: return 0x00;
        case 0x1060: return map32[addr >>> 2] >> 0;
        case 0x1070: return window.cpu ? window.cpu.istat >> 0 : 0;
        case 0x1074: return window.cpu ? window.cpu.imask >> 0 : 0;
        case 0x1800: return window.cdr && window.cdr.rd08r1800 ? window.cdr.rd08r1800() : 0;
        case 0x1810: return window.gpu && window.gpu.rd32r1810 ? window.gpu.rd32r1810() >> 0 : 0;
        case 0x1814: return window.gpu && window.gpu.rd32r1814 ? window.gpu.rd32r1814() >> 0 : 0;
        case 0x1820: return window.mdc && window.mdc.rd32r1820 ? window.mdc.rd32r1820() >> 0 : 0;
        case 0x1824: return window.mdc && window.mdc.rd32r1824 ? window.mdc.rd32r1824() >> 0 : 0;
        default:
          if (addr < 0x01801000) {
            return map32[addr >>> 2] >> 0;
          }
          if (addr >= 0x01802000) {
            return map32[addr >>> 2] >> 0;
          }
          if ((addr >= 0x01801C00) && (addr < 0x01802000)) {
            return (window.spu && window.spu.getInt16 ? (window.spu.getInt16(addr & 0x3fff) & 0xffff) | ((window.spu.getInt16((addr + 2) & 0x3fff) << 16) >>> 0) : 0);
          }
      }
      return 0;
    }

    function new_memRead32(base) {
      if (base < 0x00800000) {
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 5;
        return ramView.getInt32(base & ramMask, true);
      }
      if ((base >= 0x01800000) && (base < 0x01803000)) {
        return hwRead32(base) >> 0;
      }
      if (base >= 0x01A00000 && base < 0x01A80000) {
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 9;
        return map32[base >>> 2] >> 0;
      }
      if (base >= 0x01C00000 && base < 0x01C80000) {
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 24;
        return map32[base >>> 2] >> 0;
      }
      if (base === 0x01fe0130) {
        return map32[base >>> 2] >> 0;
      }
      if (base >= 0x01000000 && base < 0x01080000) {
        if (window.psx) window.psx.clock = (window.psx.clock || 0) + 24;
        return map32[base >>> 2];
      }
      if (orig.memRead32) return orig.memRead32(base);
      W('new_memRead32: endereço inválido', base.toString(16));
      return 0;
    }

    function hwWrite8(addr, data) {
      const reg = addr & 0x3fff;
      if (reg >= 0x1080 && reg < 0x1100) { window.dma && window.dma.wr08 && window.dma.wr08(reg, data); return; }
      switch (addr & 0x3fff) {
        case 0x1040: return window.joy && window.joy.wr08r1040 && window.joy.wr08r1040(data);
        case 0x1800: return window.cdr && window.cdr.wr08r1800 && window.cdr.wr08r1800(data);
        case 0x1801: return window.cdr && window.cdr.wr08r1801 && window.cdr.wr08r1801(data);
        case 0x1802: return window.cdr && window.cdr.wr08r1802 && window.cdr.wr08r1802(data);
        case 0x1803: return window.cdr && window.cdr.wr08r1803 && window.cdr.wr08r1803(data);
      }
      W('hwWrite8: reg não tratado', addr.toString(16));
    }

    function new_memWrite8(base, data) {
      if (base < 0x00800000) {
        const addr = base & ramMask;
        map8[(addr | (window.cpu && window.cpu.forceWriteBits ? window.cpu.forceWriteBits : 0)) >>> 0] = data;
        // fastCache clearing not implemented — best-effort
        try { if (window.fastCache) window.fastCache[addr] = 0; } catch(e){}
        return;
      }
      if ((base >= 0x01800000) && (base < 0x01802000)) {
        map8[base >>> 0] = data;
        if (base >= 0x01801000) hwWrite8(base, data);
        return;
      }
      if (base === 0x1802041) {
        map8[base >>> 0] = data;
        return;
      }
      if (orig.memWrite8) return orig.memWrite8(base, data);
      W('new_memWrite8: endereço inválido', base.toString(16));
    }

    function hwWrite16(addr, data) {
      const reg = addr & 0x3fff;
      if (reg >= 0x1080 && reg < 0x1100) { window.dma && window.dma.wr16 && window.dma.wr16(reg, data); return; }
      if (reg >= 0x1100 && reg < 0x1130) { window.rtc && window.rtc.wr32 && window.rtc.wr32(reg, data); return; }
      if (reg >= 0x1C00 && reg < 0x2000) { window.spu && window.spu.setInt16 && window.spu.setInt16(reg, data >>> 0); return; }
      switch (addr & 0x3fff) {
        case 0x1014: return map16[addr >>> 1] = data;
        case 0x1048: return window.joy && window.joy.wr16r1048 && window.joy.wr16r1048(data);
        case 0x104a: return window.joy && window.joy.wr16r104a && window.joy.wr16r104a(data);
        case 0x104e: return window.joy && window.joy.wr16r104e && window.joy.wr16r104e(data);
        case 0x1058: return;
        case 0x105a: return;
        case 0x105e: return;
        case 0x1070: if (window.cpu) window.cpu.istat &= ((data & 0xffff) & window.cpu.imask); return;
        case 0x1074: if (window.cpu) window.cpu.imask = data; return;
      }
      W('hwWrite16: reg não tratado', addr.toString(16));
    }

    function new_memWrite16(base, data) {
      if (base < 0x00800000) {
        const addr = base & ramMask;
        map16[(addr | (window.cpu && window.cpu.forceWriteBits ? window.cpu.forceWriteBits : 0)) >>> 1] = data;
        try { if (window.fastCache) window.fastCache[addr] = 0; } catch(e){}
        return;
      }
      if ((base >= 0x01800000) && (base < 0x01802000)) {
        map16[base >>> 1] = data;
        if (base >= 0x01801000) hwWrite16(base, data);
        return;
      }
      if ((base >= 0x01802000) && (base < 0x01803000)) {
        map16[base >>> 1] = data;
        return;
      }
      if (orig.memWrite16) return orig.memWrite16(base, data);
      W('new_memWrite16: endereço inválido', base.toString(16));
    }

    function hwWrite32(addr, data) {
      const reg = addr & 0x3fff;
      if (reg >= 0x1080 && reg < 0x1100) { window.dma && window.dma.wr32 && window.dma.wr32(reg, data); return; }
      if (reg >= 0x1100 && reg < 0x1130) { window.rtc && window.rtc.wr32 && window.rtc.wr32(reg, data); return; }
      if (reg >= 0x1C00 && reg < 0x2000) {
        window.spu && window.spu.setInt16 && window.spu.setInt16(reg + 0, data >>> 0);
        window.spu && window.spu.setInt16 && window.spu.setInt16(reg + 2, data >>> 16);
        return;
      }
      switch (reg) {
        case 0x1000: return;
        case 0x1004: return;
        case 0x1008: return;
        case 0x100c: return;
        case 0x1010: return;
        case 0x1014: return;
        case 0x1018: return;
        case 0x101c: return;
        case 0x1020: return;
        case 0x1060: return;
        case 0x1070: if (window.cpu) window.cpu.istat &= (data & window.cpu.imask); return;
        case 0x1074: if (window.cpu) window.cpu.imask = data >>> 0; return;
        case 0x1810: return window.gpu && window.gpu.wr32r1810 && window.gpu.wr32r1810(data);
        case 0x1814: return window.gpu && window.gpu.wr32r1814 && window.gpu.wr32r1814(data);
        case 0x1820: return window.mdc && window.mdc.wr32r1820 && window.mdc.wr32r1820(data);
        case 0x1824: return window.mdc && window.mdc.wr32r1824 && window.mdc.wr32r1824(data);
      }
      W('hwWrite32: reg não tratado', addr.toString(16));
    }

    function new_memWrite32(base, data) {
      if (base < 0x00800000) {
        const addr = base & ramMask;
        map32[(addr | (window.cpu && window.cpu.forceWriteBits ? window.cpu.forceWriteBits : 0)) >>> 2] = data;
        try { if (window.fastCache) window.fastCache[addr] = 0; } catch(e){}
        return;
      }
      if ((base >= 0x01800000) && (base < 0x01802000)) {
        map32[base >>> 2] = data;
        if (base >= 0x01801000) hwWrite32(base, data);
        return;
      }
      if (base === 0x01fe0130) {
        map32[base >>> 2] = data;
        return;
      }
      if (orig.memWrite32) return orig.memWrite32(base, data);
      W('new_memWrite32: endereço inválido', base.toString(16));
    }

    // Install replacements globally (the loader copies mmu exports onto window, so override those)
    try {
      window.memRead8 = new_memRead8;
      window.memRead16 = new_memRead16;
      window.memRead32 = new_memRead32;
      window.memWrite8 = new_memWrite8;
      window.memWrite16 = new_memWrite16;
      window.memWrite32 = new_memWrite32;
      // update ram view reference
      window.ram = ramView;
      // keep old map/map8/map16 as-is (we used them)
      L('memRead/memWrite substituídos — RAM virtual agora usa máscara:', '0x' + ramMask.toString(16), `(${opts.newRamMB}MB)`);
      // expose some info
      window.__PSX_RAM_INJECTOR__ = { installed: true, newRamMB: opts.newRamMB, ramMask: ramMask };
      return true;
    } catch (e) {
      E('Falha ao instalar replacements', e);
      return false;
    }
  }

  // Poller que aguarda as variáveis do mmu estarem prontas
  function poll() {
    const start = performance.now();
    const id = setInterval(() => {
      if (performance.now() - start > opts.pollTimeout) {
        clearInterval(id);
        W('timeout — não encontrou mmu exports para substituir.');
        return;
      }
      const found = findExports();
      // ensure at least map or ram present
      if ((found.map && found.map.buffer) || found.ram) {
        clearInterval(id);
        const newRamBytes = opts.newRamMB * 1024 * 1024;
        const ramMask = maskFromBytes(newRamBytes);
        L('found mmu exports — applying replacements with mask 0x' + ramMask.toString(16));
        const ok = makeReplacements(found, ramMask);
        if (!ok) W('replace failed');
      } else {
        // keep waiting
        L('aguardando exposicao de mmu (map/ram) ...');
      }
    }, opts.pollInterval);
  }

  // API pública
  window.PSXInjectorRAM = {
    configure: (o={}) => { opts = Object.assign(opts, o); L('config updated', opts); },
    run: () => { poll(); },
    restore: () => {
      L('restore: recarregue a página para reverter completamente (restore parcial nao implementado).');
    }
  };

  L('PSX RAM Injector carregado — iniciando poll...');
  setTimeout(() => poll(), 20);

})();