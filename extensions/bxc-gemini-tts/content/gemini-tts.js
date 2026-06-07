// bxc Gemini TTS — content script pour gemini.google.com
//
// Stratégie :
//  1. Marquer toutes les réponses déjà présentes comme « historique » (jamais lues).
//  2. Observer le DOM. Quand une NOUVELLE réponse du modèle apparaît et que son
//     texte se stabilise (fin du streaming), la lire à voix haute.
//  3. Une barre de contrôle flottante (Material 3) : Auto / Lire / Pause / Stop.
//
// TTS natif (window.speechSynthesis), voix FRANÇAISES uniquement. Aucun réseau.

"use strict";

(() => {
  const SEEN = "bxcTtsSeen";
  const DONE = "bxcTtsDone";
  const STREAM_IDLE_MS = 1400;

  const RESPONSE_SELECTOR = [
    "message-content.model-response-text",
    ".model-response-text",
    "model-response .markdown",
    ".conversation-container .markdown",
  ].join(",");

  const synth = window.speechSynthesis;
  if (!synth) return;

  let settings = { autoRead: true, voiceURI: "", rate: 1, pitch: 1 };
  let frVoices = [];
  let lastText = "";
  const timers = new WeakMap();

  // --- réglages -----------------------------------------------------------
  async function loadSettings() {
    const s = await chrome.storage.sync.get(["autoRead", "voiceURI", "rate", "pitch"]);
    settings = {
      autoRead: s.autoRead ?? true,
      voiceURI: s.voiceURI ?? "",
      rate: s.rate ?? 1,
      pitch: s.pitch ?? 1,
    };
  }

  // --- voix (françaises uniquement) --------------------------------------
  function refreshVoices() {
    frVoices = synth.getVoices().filter((v) => (v.lang || "").toLowerCase().startsWith("fr"));
  }

  function pickVoice() {
    if (settings.voiceURI) {
      const exact = frVoices.find((v) => v.voiceURI === settings.voiceURI);
      if (exact) return exact;
    }
    return frVoices[0] || null; // meilleure voix FR disponible
  }

  function clamp(n, lo, hi) {
    const x = Number(n);
    if (Number.isNaN(x)) return 1;
    return Math.min(hi, Math.max(lo, x));
  }

  // --- synthèse -----------------------------------------------------------
  function speak(text) {
    const clean = (text || "").trim();
    if (!clean) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      u.lang = "fr-FR"; // pas de voix installée : on force la langue FR
    }
    u.rate = clamp(settings.rate, 0.5, 2);
    u.pitch = clamp(settings.pitch, 0, 2);
    u.addEventListener("start", updateControls);
    u.addEventListener("end", updateControls);
    lastText = clean;
    synth.speak(u);
    updateControls();
  }

  // --- détection de fin de streaming -------------------------------------
  function scheduleSpeak(el) {
    if (!el || el.dataset[DONE]) return;
    const prev = timers.get(el);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      if (el.dataset[DONE]) return;
      const text = (el.innerText || "").trim();
      if (!text) return;
      el.dataset[DONE] = "1";
      if (settings.autoRead) speak(text);
    }, STREAM_IDLE_MS);
    timers.set(el, t);
  }

  function markExisting() {
    document.querySelectorAll(RESPONSE_SELECTOR).forEach((el) => {
      el.dataset[SEEN] = "1";
      el.dataset[DONE] = "1";
    });
  }

  function collectResponses(node) {
    const out = [];
    if (node && node.nodeType === 1) {
      if (node.matches && node.matches(RESPONSE_SELECTOR)) out.push(node);
      if (node.querySelectorAll) node.querySelectorAll(RESPONSE_SELECTOR).forEach((e) => out.push(e));
    }
    return out;
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        collectResponses(node).forEach((el) => {
          if (!el.dataset[SEEN]) scheduleSpeak(el);
        });
      }
      if (m.type === "characterData" || m.type === "childList") {
        const base = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        const el = base && base.closest ? base.closest(RESPONSE_SELECTOR) : null;
        if (el && !el.dataset[SEEN] && !el.dataset[DONE]) scheduleSpeak(el);
      }
    }
  });

  // --- barre de contrôle flottante (Material 3) --------------------------
  let bar = null;
  let autoBtn = null;
  let toggleBtn = null;

  function makeButton(label, title, variant) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `bxc-tts-btn ${variant || ""}`.trim();
    b.textContent = label;
    b.title = title;
    return b;
  }

  function buildControls() {
    bar = document.createElement("div");
    bar.className = "bxc-tts-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Lecture vocale bxc");

    autoBtn = makeButton("", "Lecture automatique des réponses", "bxc-tts-auto");
    autoBtn.addEventListener("click", async () => {
      settings.autoRead = !settings.autoRead;
      await chrome.storage.sync.set({ autoRead: settings.autoRead });
      if (!settings.autoRead) synth.cancel();
      updateControls();
    });

    const readBtn = makeButton("Lire", "Lire la dernière réponse");
    readBtn.addEventListener("click", () => {
      const els = document.querySelectorAll(RESPONSE_SELECTOR);
      const el = els[els.length - 1];
      if (el) speak((el.innerText || "").trim());
    });

    toggleBtn = makeButton("Pause", "Pause / Reprendre");
    toggleBtn.addEventListener("click", () => {
      if (synth.speaking && !synth.paused) synth.pause();
      else if (synth.paused) synth.resume();
      updateControls();
    });

    const stopBtn = makeButton("Stop", "Arrêter la lecture");
    stopBtn.addEventListener("click", () => {
      synth.cancel();
      updateControls();
    });

    bar.append(autoBtn, readBtn, toggleBtn, stopBtn);
    document.body.appendChild(bar);
    updateControls();
  }

  function updateControls() {
    if (!bar) return;
    if (autoBtn) {
      autoBtn.textContent = settings.autoRead ? "Auto ON" : "Auto OFF";
      autoBtn.classList.toggle("bxc-tts-on", settings.autoRead);
    }
    if (toggleBtn) toggleBtn.textContent = synth.paused ? "Reprendre" : "Pause";
    bar.classList.toggle("bxc-tts-speaking", synth.speaking);
  }

  // --- messages (depuis le popup) ----------------------------------------
  function handleMessage(msg, _sender, sendResponse) {
    (async () => {
      switch (msg && msg.type) {
        case "bxc-stop":
          synth.cancel();
          break;
        case "bxc-pause":
          synth.pause();
          break;
        case "bxc-resume":
          synth.resume();
          break;
        case "bxc-replay":
          if (lastText) speak(lastText);
          break;
        case "bxc-read-last": {
          const els = document.querySelectorAll(RESPONSE_SELECTOR);
          const el = els[els.length - 1];
          if (el) speak((el.innerText || "").trim());
          break;
        }
        default:
          break;
      }
      updateControls();
      sendResponse({ ok: true, speaking: synth.speaking, paused: synth.paused });
    })();
    return true;
  }

  // --- init ---------------------------------------------------------------
  async function init() {
    await loadSettings();
    refreshVoices();
    synth.addEventListener("voiceschanged", refreshVoices);

    markExisting();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    buildControls();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      for (const key of Object.keys(changes)) settings[key] = changes[key].newValue;
      updateControls();
    });

    chrome.runtime.onMessage.addListener(handleMessage);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
