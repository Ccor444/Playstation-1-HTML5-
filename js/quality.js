// ==========================================
// 🎮 QUALITY.JS – Conversão e interceptação da função de qualidade
// ==========================================
(() => {
  console.log('[Quality] Módulo PSX Quality Manager carregado.');

  const labels = ["Performance", "Balanceado", "Suave", "Máxima"];
  let currentLevel = 0;

  const QualityControl = {
    btn: null,
    originalUpdate: null,

    init() {
      this.btn = document.getElementById('quality-btn');
      if (!this.btn) {
        console.warn('[Quality] Botão #quality-btn não encontrado.');
        return;
      }

      // Espera o emulador carregar
      const interval = setInterval(() => {
        if (typeof settings !== 'undefined' && typeof settings.updateQuality === 'function') {
          clearInterval(interval);
          this.hookFunction();
          this.updateLabel();
          this.btn.addEventListener('click', () => this.toggleQuality());
          console.log('[Quality] Interceptação de função concluída.');
        }
      }, 500);
    },

    hookFunction() {
      // Guarda a função original
      this.originalUpdate = settings.updateQuality;

      // Cria uma nova função que muda o texto e chama a original
      settings.updateQuality = (manual = false) => {
        if (manual) currentLevel = (currentLevel + 1) % labels.length;
        this.updateLabel();
        console.log(`[Quality] Nível de qualidade ajustado: ${labels[currentLevel]}`);
        this.originalUpdate.call(settings, manual);
      };
    },

    updateLabel() {
      this.btn.textContent = `🎮 Qualidade: ${labels[currentLevel]}`;
    },

    toggleQuality() {
      try {
        settings.updateQuality(true);
      } catch (err) {
        console.error('[Quality] Erro ao alternar qualidade:', err);
      }
    }
  };

  window.addEventListener('DOMContentLoaded', () => QualityControl.init());
})();