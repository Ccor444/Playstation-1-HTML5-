(() => {
  console.log('[VirtualGamepad] Inicializando sistema de entrada avançado...');

  // ==========================================
  // 🎮 CONFIGURAÇÃO DE BOTÕES
  // ==========================================
  const buttonMap = {
    up:       { byte: 'lo', mask: 0x10 },
    down:     { byte: 'lo', mask: 0x40 },
    left:     { byte: 'lo', mask: 0x80 },
    right:    { byte: 'lo', mask: 0x20 },
    select:   { byte: 'lo', mask: 0x01 },
    start:    { byte: 'lo', mask: 0x08 },
    triangle: { byte: 'hi', mask: 0x10 },
    circle:   { byte: 'hi', mask: 0x20 },
    cross:    { byte: 'hi', mask: 0x40 },
    square:   { byte: 'hi', mask: 0x80 },
    l1:       { byte: 'hi', mask: 0x04 },
    l2:       { byte: 'hi', mask: 0x01 },
    r1:       { byte: 'hi', mask: 0x08 },
    r2:       { byte: 'hi', mask: 0x02 },
    l3:       { byte: 'aux', mask: 0x01 }, // adicionado
    r3:       { byte: 'aux', mask: 0x02 }  // adicionado
  };

  const debug = false; // ativar logs detalhados
  const safe = true;   // garante reset automático de botões

  // ==========================================
  // 🧩 UTILITÁRIOS
  // ==========================================
  const log = (...args) => debug && console.log('[Gamepad]', ...args);

  const getDevice = (index = 0) => {
    if (window.joy && Array.isArray(joy.devices)) return joy.devices[index] || null;
    return null;
  };

  const ensureInit = (dev, byte) => {
    if (dev[byte] === undefined) dev[byte] = 0xff;
  };

  const callHandleGamePads = () => {
    try {
      if (typeof handleGamePads === 'function') handleGamePads();
    } catch (err) {
      log('handleGamePads ausente:', err);
    }
  };

  const pressButton = (dev, byte, mask) => {
    ensureInit(dev, byte);
    dev[byte] &= ~mask;
    callHandleGamePads();
  };

  const releaseButton = (dev, byte, mask) => {
    ensureInit(dev, byte);
    dev[byte] |= mask;
    callHandleGamePads();
  };

  // ==========================================
  // 🖱️ CRIAÇÃO DE EVENTOS DE BOTÕES
  // ==========================================
  Object.entries(buttonMap).forEach(([id, { byte, mask }]) => {
    const el = document.getElementById(id);
    if (!el) return;

    let pressed = false;

    const press = () => {
      const dev = getDevice();
      if (!dev || pressed) return;
      pressed = true;
      pressButton(dev, byte, mask);
      log('Pressionado:', id);
    };

    const release = () => {
      const dev = getDevice();
      if (!dev || !pressed) return;
      pressed = false;
      releaseButton(dev, byte, mask);
      log('Solto:', id);
    };

    el.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
    el.addEventListener('pointerup', e => { e.preventDefault(); release(); });
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);

    el.addEventListener('touchstart', e => { e.preventDefault(); press(); }, { passive: false });
    el.addEventListener('touchend', e => { e.preventDefault(); release(); }, { passive: false });
    el.addEventListener('touchcancel', release);

    el.addEventListener('contextmenu', e => e.preventDefault());
  });

  // ==========================================
  // ⌨️ MAPEAMENTO DE TECLADO
  // ==========================================
  const keyboard = new Map([
    [69, { bits: 0x10, property: 'hi' }], // E -> triangle
    [68, { bits: 0x20, property: 'hi' }], // D -> circle
    [88, { bits: 0x40, property: 'hi' }], // X -> cross
    [83, { bits: 0x80, property: 'hi' }], // S -> square
    [81, { bits: 0x01, property: 'hi' }], // Q -> l2
    [84, { bits: 0x02, property: 'hi' }], // T -> r2
    [87, { bits: 0x04, property: 'hi' }], // W -> l1
    [82, { bits: 0x08, property: 'hi' }], // R -> r1
    [38, { bits: 0x10, property: 'lo' }], // ↑
    [39, { bits: 0x20, property: 'lo' }], // →
    [40, { bits: 0x40, property: 'lo' }], // ↓
    [37, { bits: 0x80, property: 'lo' }], // ←
    [32, { bits: 0x01, property: 'lo' }], // espaço -> select
    [13, { bits: 0x08, property: 'lo' }]  // enter -> start
  ]);

  const preventKeys = new Set([32,37,38,39,40]);

  window.addEventListener('keydown', e => {
    const m = keyboard.get(e.keyCode);
    const dev = getDevice();
    if (!m || !dev) return;
    ensureInit(dev, m.property);
    dev[m.property] &= ~m.bits;
    callHandleGamePads();
    if (preventKeys.has(e.keyCode)) e.preventDefault();
  });

  window.addEventListener('keyup', e => {
    const m = keyboard.get(e.keyCode);
    const dev = getDevice();
    if (!m || !dev) return;
    ensureInit(dev, m.property);
    dev[m.property] |= m.bits;
    callHandleGamePads();
  });

  // ==========================================
  // 🧠 RESET SEGURO AO PERDER FOCO
  // ==========================================
  window.addEventListener('blur', () => {
    const dev = getDevice();
    if (!dev) return;
    dev.lo = 0xff;
    dev.hi = 0xff;
    dev.aux = 0xff; // reset do novo byte
    callHandleGamePads();
    log('Reset de segurança executado.');
  });

  // ==========================================
  // ⚙️ MULTIDEVICE E AUTO-DETECT
  // ==========================================
  const observer = new MutationObserver(() => {
    const dev = getDevice();
    if (dev) {
      log('Dispositivo detectado:', dev);
      observer.disconnect();
    }
  });

  if (window.joy) observer.observe(document.body, { childList: true, subtree: true });

  // ==========================================
  // 🧭 API PÚBLICA (opcional)
  // ==========================================
  window.VirtualGamepad = {
    press(id) {
      const map = buttonMap[id];
      const dev = getDevice();
      if (!map || !dev) return;
      pressButton(dev, map.byte, map.mask);
    },
    release(id) {
      const map = buttonMap[id];
      const dev = getDevice();
      if (!map || !dev) return;
      releaseButton(dev, map.byte, map.mask);
    },
    reset() {
      const dev = getDevice();
      if (!dev) return;
      dev.lo = dev.hi = dev.aux = 0xff; // reset incluindo aux
      callHandleGamePads();
    }
  };

  log('Sistema de controle virtual pronto.');
})();