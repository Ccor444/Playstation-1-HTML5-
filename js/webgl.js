// webgl.js
mdlr('enge:webgl2', (m) => {
  const { createVertexBuffer, createProgramFromScripts } = m.require('enge:webgl2:utils');

  // ===============================
  // Variáveis e Buffers
  // ===============================
  const $gpu = {};
  const sbgr2rgba = new Uint32Array(65536);
  const transfer = new Uint32Array(4096 * 2048);
  const view = new Uint8Array(transfer.buffer);

  const vertexBuffer = createVertexBuffer();

  for (let i = 0; i < 65536; ++i) {
    sbgr2rgba[i] = ((i >>> 0) & 0x1f) << 3;      // r
    sbgr2rgba[i] |= ((i >>> 5) & 0x1f) << 11;    // g
    sbgr2rgba[i] |= ((i >>> 10) & 0x1f) << 19;   // b
    sbgr2rgba[i] |= ((i >>> 15) & 0x01) ? 0xff000000 : 0; // a
  }

  // ===============================
  // Inicialização do WebGL
  // ===============================
  const canvas = document.getElementById('display');
  let gl = null;
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      depth: false,
      stencil: false,
    });
  } catch (e) {
    console.error('WebGL2 não suportado.');
    return;
  }

  const GL_CONSTANTS = {
    ONE: gl.ONE, ZERO: gl.ZERO, CONSTANT_ALPHA: gl.CONSTANT_ALPHA, BLEND: gl.BLEND,
    FUNC_ADD: gl.FUNC_ADD, STENCIL_TEST: gl.STENCIL_TEST, FRAMEBUFFER: gl.FRAMEBUFFER,
    READ_FRAMEBUFFER: gl.READ_FRAMEBUFFER, DRAW_FRAMEBUFFER: gl.DRAW_FRAMEBUFFER,
    COLOR_ATTACHMENT0: gl.COLOR_ATTACHMENT0, TEXTURE_2D: gl.TEXTURE_2D, RGBA: gl.RGBA,
    UNSIGNED_BYTE: gl.UNSIGNED_BYTE, NEAREST: gl.NEAREST, COLOR_BUFFER_BIT: gl.COLOR_BUFFER_BIT
  };

  const gl_bindFramebuffer = gl.bindFramebuffer.bind(gl);
  const gl_framebufferTexture2D = gl.framebufferTexture2D.bind(gl);
  const gl_blitFramebuffer = gl.blitFramebuffer.bind(gl);
  const gl_bindTexture = gl.bindTexture.bind(gl);
  const gl_texSubImage2D = gl.texSubImage2D.bind(gl);
  const gl_enable = gl.enable.bind(gl);
  const gl_disable = gl.disable.bind(gl);
  const gl_enableVertexAttribArray = gl.enableVertexAttribArray.bind(gl);
  const gl_vertexAttribPointer = gl.vertexAttribPointer.bind(gl);

  // ===============================
  // Funções auxiliares
  // ===============================
  const largePrimitive = (x1, y1, x2, y2, x3, y3, x4 = x3, y4 = y3) => {
    return Math.abs(x1 - x2) > 1023 || Math.abs(x2 - x3) > 1023 || Math.abs(x3 - x1) > 1023 ||
           Math.abs(x4 - x2) > 1023 || Math.abs(x4 - x3) > 1023 ||
           Math.abs(y1 - y2) > 511 || Math.abs(y2 - y3) > 511 || Math.abs(y3 - y1) > 511 ||
           Math.abs(y4 - y2) > 511 || Math.abs(y4 - y3) > 511;
  };

  const outsideDrawArea = (x1, y1, x2, y2, x3, y3, x4 = x3, y4 = y3) => {
    if ((x1 < $gpu.daL) && (x2 < $gpu.daL) && (x3 < $gpu.daL) && (x4 < $gpu.daL)) return true;
    if ((x1 > $gpu.daR) && (x2 > $gpu.daR) && (x3 > $gpu.daR) && (x4 > $gpu.daR)) return true;
    if ((y1 < $gpu.daT) && (y2 < $gpu.daT) && (y3 < $gpu.daT) && (y4 < $gpu.daT)) return true;
    if ((y1 > $gpu.daB) && (y2 > $gpu.daB) && (y3 > $gpu.daB) && (y4 > $gpu.daB)) return true;
    return false;
  };

  function getColor(data, index = 0, forceFlat = false) {
    const mask = forceFlat || (data[0] & 0x10000000) ? 0x00f8f8f8 : 0x00ffffff;
    return (data[0] & 0xff000000) | (data[index] & mask);
  }

  // ===============================
  // Classe WebGLRenderer
  // ===============================
  class WebGLRenderer {
    constructor() {
      this.mode = 'disp';
      this.fpsRenderCounter = 0;
      this.fpsCounter = 0;
      this.seenRender = false;

      if (gl) {
        gl_disable(GL_CONSTANTS.STENCIL_TEST);
        gl_disable(gl.DEPTH_TEST);
        gl_disable(GL_CONSTANTS.BLEND);
        gl_enableVertexAttribArray(0);

        this.displayBuffer = gl.createBuffer();
        this.renderBuffer = gl.createBuffer();
      }
    }

    setDrawAreaOF(x, y) { $gpu.daX = x; $gpu.daY = y; }
    setDrawAreaTL(x, y) { $gpu.daL = x; $gpu.daT = y; $gpu.daM = true; }
    setDrawAreaBR(x, y) { $gpu.daR = x; $gpu.daB = y; $gpu.daM = true; }

    drawLine(data, c1, xy1, c2, xy2) {
      this.seenRender = true;
      const x1 = $gpu.daX + ((data[xy1] << 21) >> 21);
      const y1 = $gpu.daY + ((data[xy1] << 5) >> 21);
      const x2 = $gpu.daX + ((data[xy2] << 21) >> 21);
      const y2 = $gpu.daY + ((data[xy2] << 5) >> 21);
      if (outsideDrawArea(x1, y1, x2, y2, x1, y1)) return;
      if (largePrimitive(x1, y1, x2, y2, x1, y1)) return;
      c1 = getColor(data, c1);
      c2 = getColor(data, c2);
      // Aqui você adicionaria vertices no vertexBuffer
    }

    drawRectangle(data, tx, ty, cl) {
      this.seenRender = true;
      const x = $gpu.daX + ((data[1] << 21) >> 21);
      const y = $gpu.daY + ((data[1] << 5) >> 21);
      const w = (data[2] << 16) >> 16;
      const h = (data[2] >> 16);
      if (!w || !h) return;
    }

    fillRectangle(data) {
      this.seenRender = true;
      const x = (data[1] << 16) >>> 16;
      const y = (data[1] << 0) >>> 16;
      const w = (data[2] << 16) >>> 16;
      const h = (data[2] << 0) >>> 16;
      const c = (data[0] & 0x00f8f8f8);
      if (!w && !h) return;
    }

    setMode(mode) { this.mode = mode; this.seenRender = true; }
  }

  // ===============================
  // Injetando no módulo
  // ===============================
  m.WebGLRenderer = WebGLRenderer;
  m.sbgr2rgba = sbgr2rgba;
  m.transfer = transfer;
  m.view = view;
  m.gl = gl;

  return m;
});