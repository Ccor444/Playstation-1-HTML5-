"use strict";

const SoundManager = (() => {
  let context = null;
  let gainNode = null;
  let frameCount = 0;
  let writeIndex = 0;

  // Buffers duplos
  let bufferA = null, bufferB = null;
  let leftA = null, rightA = null;
  let leftB = null, rightB = null;
  let activeBuffer = 'A';

  // Volumes multi-canais
  let volumes = {
    main: { L: 1.0, R: 1.0 },
    cd: { L: 1.0, R: 1.0 },
    ext: { L: 1.0, R: 1.0 }
  };

  // ------------------------------
  // Efeitos PS1
  // ------------------------------
  let effectFn = null;

  // Simula reverb PS1 com delay simples + low-pass
  const ps1Reverb = (() => {
    const delaySamples = 4000; // ~90ms a 44.1kHz
    const bufferL = new Float32Array(delaySamples).fill(0);
    const bufferR = new Float32Array(delaySamples).fill(0);
    let idx = 0;
    return (l, r) => {
      const outL = l + bufferL[idx] * 0.5;
      const outR = r + bufferR[idx] * 0.5;

      // low-pass simples (média móvel)
      bufferL[idx] = (l + bufferL[idx] * 0.7) / 1.7;
      bufferR[idx] = (r + bufferR[idx] * 0.7) / 1.7;

      idx = (idx + 1) % delaySamples;
      return [outL, outR];
    };
  })();

  // ------------------------------
  // Inicializa áudio
  // ------------------------------
  const init = (sampleRate = 44100, durationSec = 0.5) => {
    if (context) return;

    context = new (window.AudioContext || window.webkitAudioContext)();
    gainNode = context.createGain();
    gainNode.gain.value = 1.0;
    gainNode.connect(context.destination);

    frameCount = Math.floor(sampleRate * durationSec);

    bufferA = context.createBuffer(2, frameCount, context.sampleRate);
    bufferB = context.createBuffer(2, frameCount, context.sampleRate);
    leftA = bufferA.getChannelData(0); rightA = bufferA.getChannelData(1);
    leftB = bufferB.getChannelData(0); rightB = bufferB.getChannelData(1);
    leftA.fill(0); rightA.fill(0); leftB.fill(0); rightB.fill(0);

    playBuffer('A');
  };

  // ------------------------------
  // Toca um buffer
  // ------------------------------
  const playBuffer = (which) => {
    const buf = which === 'A' ? bufferA : bufferB;
    const source = context.createBufferSource();
    source.buffer = buf;
    source.connect(gainNode);
    source.loop = false;
    source.start();
    source.onended = () => {
      activeBuffer = activeBuffer === 'A' ? 'B' : 'A';
      playBuffer(activeBuffer);
    };
  };

  // ------------------------------
  // Clamping + dithering avançado
  // ------------------------------
  const clamp = (v) => {
    const dither = (Math.random() - 0.5) / 32768; // mais perceptível
    return Math.max(-1, Math.min(1, v + dither));
  };

  // ------------------------------
  // Processa efeitos
  // ------------------------------
  const processEffect = (l, r) => {
    if (effectFn) return effectFn(l, r);
    return ps1Reverb(l, r); // default: reverb PS1
  };

  // ------------------------------
  // Escreve amostra
  // ------------------------------
  const writeSample = (l, r, options = {}) => {
    let finalL = 0, finalR = 0;

    finalL += (l * (options.mainL ?? volumes.main.L));
    finalR += (r * (options.mainR ?? volumes.main.R));
    finalL += (l * (options.cdL ?? volumes.cd.L));
    finalR += (r * (options.cdR ?? volumes.cd.R));
    finalL += (l * (options.extL ?? volumes.ext.L));
    finalR += (r * (options.extR ?? volumes.ext.R));

    [finalL, finalR] = processEffect(finalL, finalR);

    const lBuf = activeBuffer === 'A' ? leftA : leftB;
    const rBuf = activeBuffer === 'A' ? rightA : rightB;

    lBuf[writeIndex] = clamp(finalL);
    rBuf[writeIndex] = clamp(finalR);

    writeIndex = (writeIndex + 1) % frameCount;
  };

  // ------------------------------
  // Silencia buffers
  // ------------------------------
  const silence = () => {
    leftA.fill(0); rightA.fill(0);
    leftB.fill(0); rightB.fill(0);
  };

  // ------------------------------
  // Configura volumes
  // ------------------------------
  const setVolume = ({ mainL, mainR, cdL, cdR, extL, extR }) => {
    if (mainL !== undefined) volumes.main.L = mainL;
    if (mainR !== undefined) volumes.main.R = mainR;
    if (cdL !== undefined) volumes.cd.L = cdL;
    if (cdR !== undefined) volumes.cd.R = cdR;
    if (extL !== undefined) volumes.ext.L = extL;
    if (extR !== undefined) volumes.ext.R = extR;
  };

  const setEffect = (fn) => { effectFn = fn; };

  return {
    init,
    writeSample,
    silence,
    setVolume,
    setEffect,
    isReady: () => !!context,
    get frameCount() { return frameCount; }
  };
})();

window.SoundManager = SoundManager;