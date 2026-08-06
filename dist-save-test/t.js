"use strict";
(() => {
  // src/lib/gameMode.ts
  function saving(s) {
    if (!s.enabled) return false;
    if (!s.gameRunning) return false;
    return !s.visible && !s.focused;
  }
  var SAVE_SLOWDOWN = 4;
  function slowMs(ms, \u0431\u0435\u0440\u0435\u0436\u0451\u043C2) {
    return \u0431\u0435\u0440\u0435\u0436\u0451\u043C2 ? Math.round(ms * SAVE_SLOWDOWN) : ms;
  }
  var \u0441\u0435\u0439\u0447\u0430\u0441 = { gameRunning: false, visible: true, focused: true, enabled: true };
  var \u0431\u0435\u0440\u0435\u0436\u0451\u043C = false;
  var \u0441\u043B\u0443\u0448\u0430\u0442\u0435\u043B\u0438 = /* @__PURE__ */ new Set();
  var isSaving = () => \u0431\u0435\u0440\u0435\u0436\u0451\u043C;
  function updateGameState(\u0447\u0430\u0441\u0442\u044C) {
    \u0441\u0435\u0439\u0447\u0430\u0441 = { ...\u0441\u0435\u0439\u0447\u0430\u0441, ...\u0447\u0430\u0441\u0442\u044C };
    const \u043D\u0430\u0434\u043E = saving(\u0441\u0435\u0439\u0447\u0430\u0441);
    if (\u043D\u0430\u0434\u043E === \u0431\u0435\u0440\u0435\u0436\u0451\u043C) return false;
    \u0431\u0435\u0440\u0435\u0436\u0451\u043C = \u043D\u0430\u0434\u043E;
    \u0441\u043B\u0443\u0448\u0430\u0442\u0435\u043B\u0438.forEach((fn) => {
      try {
        fn(\u0431\u0435\u0440\u0435\u0436\u0451\u043C);
      } catch {
      }
    });
    return true;
  }
  function onSaving(fn) {
    \u0441\u043B\u0443\u0448\u0430\u0442\u0435\u043B\u0438.add(fn);
    return () => {
      \u0441\u043B\u0443\u0448\u0430\u0442\u0435\u043B\u0438.delete(fn);
    };
  }
  function resetGameState() {
    \u0441\u0435\u0439\u0447\u0430\u0441 = { gameRunning: false, visible: true, focused: true, enabled: true };
    \u0431\u0435\u0440\u0435\u0436\u0451\u043C = false;
    \u0441\u043B\u0443\u0448\u0430\u0442\u0435\u043B\u0438.clear();
  }

  // src/music/spectrum.ts
  var BANDS = 32;
  function toBands(raw, bands = BANDS) {
    const n = raw.length;
    const out2 = [];
    if (!n) return new Array(bands).fill(0);
    for (let i = 0; i < bands; i++) {
      const \u043E\u0442 = Math.floor(n * (Math.pow(2, i / bands) - 1));
      const \u0434\u043E = Math.max(\u043E\u0442 + 1, Math.floor(n * (Math.pow(2, (i + 1) / bands) - 1)));
      let \u0441\u0443\u043C\u043C\u0430 = 0, \u0441\u0447\u0451\u0442 = 0;
      for (let j = \u043E\u0442; j < Math.min(\u0434\u043E, n); j++) {
        \u0441\u0443\u043C\u043C\u0430 += raw[j];
        \u0441\u0447\u0451\u0442++;
      }
      out2.push(\u0441\u0447\u0451\u0442 ? Math.round(\u0441\u0443\u043C\u043C\u0430 / \u0441\u0447\u0451\u0442) / 255 : 0);
    }
    return out2;
  }
  function toLevel(wave) {
    if (!wave.length) return 0;
    let s = 0;
    for (let i = 0; i < wave.length; i++) {
      const d = (wave[i] - 128) / 128;
      s += d * d;
    }
    return Math.round(Math.sqrt(s / wave.length) * 1e3) / 1e3;
  }
  var \u0430\u043D\u0430\u043B\u0438\u0437\u0430\u0442\u043E\u0440 = null;
  var \u0431\u0443\u0444\u0435\u0440 = null;
  var \u0432\u043E\u043B\u043D\u0430 = null;
  var \u043F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u0438 = /* @__PURE__ */ new Set();
  var \u043A\u0430\u0434\u0440 = 0;
  var \u043E\u0442\u0434\u0430\u0442\u044C = null;
  function setSpectrumEmit(fn) {
    \u043E\u0442\u0434\u0430\u0442\u044C = fn;
  }
  var \u0441\u043B\u0443\u0448\u0430\u0442\u0435\u043B\u0438\u0413\u043E\u0442\u043E\u0432\u043D\u043E\u0441\u0442\u0438 = /* @__PURE__ */ new Set();
  function setAnalyser(a) {
    \u0430\u043D\u0430\u043B\u0438\u0437\u0430\u0442\u043E\u0440 = a;
    \u0431\u0443\u0444\u0435\u0440 = a ? new Uint8Array(a.frequencyBinCount) : null;
    \u0432\u043E\u043B\u043D\u0430 = a ? new Uint8Array(a.fftSize) : null;
  }
  function readSpectrum() {
    if (!\u0430\u043D\u0430\u043B\u0438\u0437\u0430\u0442\u043E\u0440 || !\u0431\u0443\u0444\u0435\u0440 || !\u0432\u043E\u043B\u043D\u0430) return { bands: new Array(BANDS).fill(0), level: 0 };
    \u0430\u043D\u0430\u043B\u0438\u0437\u0430\u0442\u043E\u0440.getByteFrequencyData(\u0431\u0443\u0444\u0435\u0440);
    \u0430\u043D\u0430\u043B\u0438\u0437\u0430\u0442\u043E\u0440.getByteTimeDomainData(\u0432\u043E\u043B\u043D\u0430);
    return { bands: toBands(\u0431\u0443\u0444\u0435\u0440), level: toLevel(\u0432\u043E\u043B\u043D\u0430) };
  }
  function \u0448\u0430\u0433() {
    if (!\u043F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u0438.size) {
      \u043A\u0430\u0434\u0440 = 0;
      return;
    }
    if (isSaving()) {
      \u043A\u0430\u0434\u0440 = 0;
      \u0436\u0434\u0451\u043C\u0412\u043E\u0437\u0432\u0440\u0430\u0442\u0430();
      return;
    }
    const k = readSpectrum();
    try {
      \u043E\u0442\u0434\u0430\u0442\u044C?.(k);
    } catch {
    }
    \u043A\u0430\u0434\u0440 = requestAnimationFrame(\u0448\u0430\u0433);
  }
  var \u043E\u0442\u043F\u0438\u0441\u043A\u0430 = null;
  function \u0436\u0434\u0451\u043C\u0412\u043E\u0437\u0432\u0440\u0430\u0442\u0430() {
    if (\u043E\u0442\u043F\u0438\u0441\u043A\u0430) return;
    \u043E\u0442\u043F\u0438\u0441\u043A\u0430 = onSaving((\u0431) => {
      if (\u0431) return;
      \u043E\u0442\u043F\u0438\u0441\u043A\u0430?.();
      \u043E\u0442\u043F\u0438\u0441\u043A\u0430 = null;
      if (\u043F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u0438.size && !\u043A\u0430\u0434\u0440 && typeof requestAnimationFrame === "function") {
        \u043A\u0430\u0434\u0440 = requestAnimationFrame(\u0448\u0430\u0433);
      }
    });
  }
  function watchSpectrum(pluginId) {
    \u043F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u0438.add(pluginId);
    \u0441\u043B\u0443\u0448\u0430\u0442\u0435\u043B\u0438\u0413\u043E\u0442\u043E\u0432\u043D\u043E\u0441\u0442\u0438.forEach((fn) => {
      try {
        fn();
      } catch {
      }
    });
    if (!\u043A\u0430\u0434\u0440 && typeof requestAnimationFrame === "function") \u043A\u0430\u0434\u0440 = requestAnimationFrame(\u0448\u0430\u0433);
  }
  function unwatchSpectrum(pluginId) {
    \u043F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u0438.delete(pluginId);
    if (!\u043F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A\u0438.size && \u043A\u0430\u0434\u0440) {
      cancelAnimationFrame(\u043A\u0430\u0434\u0440);
      \u043A\u0430\u0434\u0440 = 0;
    }
  }

  // src/lib/__save_test.ts
  var out = [];
  var pass = 0;
  var fail = 0;
  var ok = (n) => {
    pass++;
    out.push("  ok   " + n);
  };
  var bad = (n, why) => {
    fail++;
    out.push("  \u041F\u0420\u041E\u0412\u0410\u041B " + n + (why ? " \u2014 " + why : ""));
  };
  var check = (n, v, extra) => v ? ok(n + (extra ? "  \u2014 " + extra : "")) : bad(n, extra);
  function \u0444\u0430\u043B\u044C\u0448\u0438\u0432\u044B\u0439\u0410\u043D\u0430\u043B\u0438\u0437\u0430\u0442\u043E\u0440() {
    return {
      frequencyBinCount: 32,
      fftSize: 64,
      getByteFrequencyData: (a) => {
        a.fill(120);
      },
      getByteTimeDomainData: (a) => {
        a.fill(128);
      }
    };
  }
  function \u0441\u0447\u0438\u0442\u0430\u0442\u044C(\u043C\u0441) {
    return new Promise((\u0433\u043E\u0442\u043E\u0432\u043E) => {
      let n = 0;
      setSpectrumEmit(() => {
        n++;
      });
      setTimeout(() => {
        setSpectrumEmit(null);
        \u0433\u043E\u0442\u043E\u0432\u043E(n);
      }, \u043C\u0441);
    });
  }
  async function main() {
    resetGameState();
    setAnalyser(\u0444\u0430\u043B\u044C\u0448\u0438\u0432\u044B\u0439\u0410\u043D\u0430\u043B\u0438\u0437\u0430\u0442\u043E\u0440());
    watchSpectrum("\u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430");
    const \u043E\u0431\u044B\u0447\u043D\u043E = await \u0441\u0447\u0438\u0442\u0430\u0442\u044C(700);
    check("\u0432 \u043E\u0431\u044B\u0447\u043D\u043E\u0439 \u0440\u0430\u0431\u043E\u0442\u0435 \u043A\u0430\u0434\u0440\u044B \u0438\u0434\u0443\u0442", \u043E\u0431\u044B\u0447\u043D\u043E > 20, "\u043A\u0430\u0434\u0440\u043E\u0432 \u0437\u0430 0,7 \u0441: " + \u043E\u0431\u044B\u0447\u043D\u043E);
    updateGameState({ gameRunning: true, visible: false, focused: false });
    check("\u0440\u0435\u0436\u0438\u043C \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0438\u043B\u0441\u044F", isSaving() === true);
    await new Promise((r) => setTimeout(r, 120));
    const \u0431\u0435\u0440\u0435\u0436\u0451\u043C2 = await \u0441\u0447\u0438\u0442\u0430\u0442\u044C(700);
    check("\u043F\u043E\u043A\u0430 \u0431\u0435\u0440\u0435\u0436\u0451\u043C, \u043A\u0430\u0434\u0440\u043E\u0432 \u043D\u0435\u0442 \u0432\u043E\u0432\u0441\u0435", \u0431\u0435\u0440\u0435\u0436\u0451\u043C2 === 0, "\u043A\u0430\u0434\u0440\u043E\u0432 \u0437\u0430 0,7 \u0441: " + \u0431\u0435\u0440\u0435\u0436\u0451\u043C2);
    updateGameState({ visible: true, focused: true });
    check("\u0440\u0435\u0436\u0438\u043C \u0432\u044B\u043A\u043B\u044E\u0447\u0438\u043B\u0441\u044F", isSaving() === false);
    await new Promise((r) => setTimeout(r, 120));
    const \u0432\u0435\u0440\u043D\u0443\u043B\u0438\u0441\u044C = await \u0441\u0447\u0438\u0442\u0430\u0442\u044C(700);
    check("\u043F\u043E\u0441\u043B\u0435 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u043A\u0430\u0434\u0440\u044B \u0438\u0434\u0443\u0442 \u0441\u043D\u043E\u0432\u0430", \u0432\u0435\u0440\u043D\u0443\u043B\u0438\u0441\u044C > 20, "\u043A\u0430\u0434\u0440\u043E\u0432 \u0437\u0430 0,7 \u0441: " + \u0432\u0435\u0440\u043D\u0443\u043B\u0438\u0441\u044C);
    check(
      "\u0438 \u044D\u0442\u043E \u043F\u043E\u043B\u043D\u043E\u0446\u0435\u043D\u043D\u044B\u0439 \u043F\u043E\u0442\u043E\u043A, \u0430 \u043D\u0435 \u043E\u0441\u0442\u0430\u0442\u043A\u0438",
      \u0432\u0435\u0440\u043D\u0443\u043B\u0438\u0441\u044C > \u043E\u0431\u044B\u0447\u043D\u043E * 0.4,
      "\u0431\u044B\u043B\u043E " + \u043E\u0431\u044B\u0447\u043D\u043E + ", \u0441\u0442\u0430\u043B\u043E " + \u0432\u0435\u0440\u043D\u0443\u043B\u0438\u0441\u044C
    );
    updateGameState({ gameRunning: false, visible: false, focused: false });
    check("\u0431\u0435\u0437 \u0438\u0433\u0440\u044B \u0441\u0432\u0451\u0440\u043D\u0443\u0442\u043E\u0435 \u043E\u043A\u043D\u043E \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u043A\u0430\u043A \u043E\u0431\u044B\u0447\u043D\u043E", isSaving() === false);
    out.push("");
    out.push("-- \u041B\u043E\u043C\u0430\u0435\u043C \u043D\u0430\u0440\u043E\u0447\u043D\u043E --");
    check(
      "\u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043B\u043E\u0432\u0438\u0442 \xAB\u0431\u0435\u0440\u0435\u0436\u0451\u043C \u0432\u0441\u0435\u0433\u0434\u0430\xBB",
      saving({ gameRunning: false, visible: false, focused: false, enabled: true }) === false
    );
    check(
      "\u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043B\u043E\u0432\u0438\u0442 \xAB\u043D\u0435 \u0431\u0435\u0440\u0435\u0436\u0451\u043C \u043D\u0438\u043A\u043E\u0433\u0434\u0430\xBB",
      saving({ gameRunning: true, visible: false, focused: false, enabled: true }) === true
    );
    check(
      "\u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043D\u0430\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430 \u0441\u0438\u043B\u044C\u043D\u0435\u0435 \u0432\u0441\u0435\u0433\u043E",
      saving({ gameRunning: true, visible: false, focused: false, enabled: false }) === false
    );
    check(
      "\u0440\u0430\u0441\u0442\u044F\u0436\u0435\u043D\u0438\u0435 \u043F\u0440\u043E\u043C\u0435\u0436\u0443\u0442\u043A\u0430 \u043D\u0435 \u0442\u0440\u043E\u0433\u0430\u0435\u0442 \u043E\u0431\u044B\u0447\u043D\u0443\u044E \u0440\u0430\u0431\u043E\u0442\u0443",
      slowMs(6e4, false) === 6e4 && slowMs(6e4, true) === 24e4
    );
    unwatchSpectrum("\u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430");
    out.push("");
    out.push("\u0418\u0422\u041E\u0413: \u043F\u0440\u043E\u0439\u0434\u0435\u043D\u043E " + pass + ", \u043F\u0440\u043E\u0432\u0430\u043B\u0435\u043D\u043E " + fail);
    window.__saveTestDone = { text: out.join("\n"), fail };
  }
  void main();
})();
