// bxc Gemini TTS — popup. UI française, voix françaises, session Google, IA.
// Tout en async/await, aucun handler inline.

"use strict";

const VOICE_KEYS = ["autoRead", "voiceURI", "rate", "pitch"];
const BRIDGE = "http://127.0.0.1:8765";
const $ = (id) => document.getElementById(id);

let frVoices = [];

function isFrench(v) {
  return (v.lang || "").toLowerCase().startsWith("fr");
}
function setHint(t) {
  $("hint").textContent = t || "";
}

// --- voix ---------------------------------------------------------------
function loadFrVoices() {
  frVoices = window.speechSynthesis.getVoices().filter(isFrench);
}
function populateVoices(selected) {
  const sel = $("voice");
  sel.textContent = "";
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "Automatique (meilleure voix FR)";
  sel.appendChild(auto);
  for (const v of frVoices) {
    const o = document.createElement("option");
    o.value = v.voiceURI;
    o.textContent = `${v.name} (${v.lang})`;
    if (v.voiceURI === selected) o.selected = true;
    sel.appendChild(o);
  }
  if (frVoices.length === 0) {
    setHint("Aucune voix française détectée. Ajoute-en via Paramètres Windows › Heure et langue › Voix.");
  }
}
async function getVoiceSettings() {
  const s = await chrome.storage.sync.get(VOICE_KEYS);
  return { autoRead: s.autoRead ?? true, voiceURI: s.voiceURI ?? "", rate: s.rate ?? 1, pitch: s.pitch ?? 1 };
}
function speakFr(text) {
  const clean = (text || "").trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  const v = frVoices.find((x) => x.voiceURI === ($("voice").value || "")) || frVoices[0];
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  } else {
    u.lang = "fr-FR";
  }
  u.rate = Number($("rate").value);
  u.pitch = Number($("pitch").value);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

async function sendToTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { ok: false };
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return { ok: false };
  }
}

// --- session Google -----------------------------------------------------
function renderStatus(st) {
  const el = $("cookieStatus");
  if (!st) {
    el.textContent = "Jamais synchronisé.";
    el.className = "status";
    return;
  }
  const when = st.at ? new Date(st.at).toLocaleString("fr-FR") : "—";
  if (st.ok) {
    el.textContent = `OK · ${st.count ?? "?"} cookies · ${when}`;
    el.className = "status ok";
  } else {
    el.textContent = `Échec · ${st.error || "?"} · ${when}`;
    el.className = "status err";
  }
}
async function refreshStatus() {
  const r = await chrome.runtime.sendMessage({ type: "bxc-cookie-status" });
  renderStatus(r && r.status);
}

// --- IA (bridge) --------------------------------------------------------
async function ask(prompt) {
  $("aiAsk").disabled = true;
  setHint("Gemini réfléchit…");
  try {
    const res = await fetch(`${BRIDGE}/ai/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (data.ok) {
      $("aiText").textContent = data.text;
      $("aiOut").hidden = false;
      setHint("");
    } else {
      setHint(`IA: ${data.error || "erreur"}`);
    }
  } catch (e) {
    setHint(`Bridge injoignable (lance bxc-bridge). ${e.message}`);
  } finally {
    $("aiAsk").disabled = false;
  }
}

async function getActivePageText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return "";
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText.slice(0, 12000),
    });
    return result || "";
  } catch {
    return "";
  }
}

// --- init ---------------------------------------------------------------
async function init() {
  const s = await getVoiceSettings();
  $("autoRead").checked = s.autoRead;
  $("rate").value = s.rate;
  $("pitch").value = s.pitch;
  $("rateVal").textContent = Number(s.rate).toFixed(1);
  $("pitchVal").textContent = Number(s.pitch).toFixed(1);

  loadFrVoices();
  populateVoices(s.voiceURI);
  window.speechSynthesis.addEventListener("voiceschanged", async () => {
    loadFrVoices();
    const r = await chrome.storage.sync.get("voiceURI");
    populateVoices(r.voiceURI ?? "");
  });

  // voix
  $("autoRead").addEventListener("change", (e) => chrome.storage.sync.set({ autoRead: e.target.checked }));
  $("voice").addEventListener("change", (e) => chrome.storage.sync.set({ voiceURI: e.target.value }));
  $("rate").addEventListener("input", (e) => {
    $("rateVal").textContent = Number(e.target.value).toFixed(1);
    chrome.storage.sync.set({ rate: Number(e.target.value) });
  });
  $("pitch").addEventListener("input", (e) => {
    $("pitchVal").textContent = Number(e.target.value).toFixed(1);
    chrome.storage.sync.set({ pitch: Number(e.target.value) });
  });
  $("test").addEventListener("click", () => speakFr("Bonjour, ceci est un test de la voix bxc en français."));
  $("readLast").addEventListener("click", () => sendToTab({ type: "bxc-read-last" }));
  $("stop").addEventListener("click", async () => {
    window.speechSynthesis.cancel();
    await sendToTab({ type: "bxc-stop" });
  });

  // session
  await refreshStatus();
  $("syncCookies").addEventListener("click", async () => {
    $("syncCookies").disabled = true;
    $("cookieStatus").textContent = "Synchronisation…";
    await chrome.runtime.sendMessage({ type: "bxc-sync-cookies-now" });
    await refreshStatus();
    $("syncCookies").disabled = false;
  });

  // IA
  $("aiAsk").addEventListener("click", () => {
    const p = $("aiPrompt").value.trim();
    if (p) ask(p);
  });
  $("aiPage").addEventListener("click", async () => {
    setHint("Lecture de la page…");
    const text = await getActivePageText();
    if (!text) {
      setHint("Impossible de lire la page active.");
      return;
    }
    const instruction = $("aiPrompt").value.trim() || "Résume cette page en français, en quelques points clés.";
    ask(`${instruction}\n\n---\n${text}`);
  });
  $("aiSpeak").addEventListener("click", () => speakFr($("aiText").textContent));
}

document.addEventListener("DOMContentLoaded", init);
