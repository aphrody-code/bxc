// bxc Gemini TTS — service worker (Manifest V3).
//
// Deux roles :
//  1. Seed des reglages par defaut (voix / lecture).
//  2. Synchronisation de la SESSION GOOGLE : lit les cookies google.com en clair
//     via chrome.cookies (httpOnly inclus, sans App-Bound Encryption ni CDP),
//     les formate en JSON Cookie-Editor, et les POST vers un recepteur local
//     (bun) qui ecrit ~/.bxc/cookies/google.json et pousse au VPS.
//
// Ephemere : AUCUN etat en variable globale. Tout passe par chrome.storage et
// chrome.alarms (jamais setTimeout/setInterval pour la planification).

const DEFAULTS = {
  // lecture vocale
  autoRead: true,
  voiceURI: "",
  rate: 1,
  pitch: 1,
  // synchro session Google
  cookieSync: true,
  receiverUrl: "http://127.0.0.1:8765/google-cookies",
};

const SYNC_ALARM = "bxc-cookie-sync";
const SYNC_PERIOD_MIN = 30; // refresh regulier
const DEBOUNCE_ALARM = "bxc-cookie-debounce";
const KEY_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"]; // session changes to watch

// --- settings -----------------------------------------------------------
async function getSettings() {
  const s = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...s };
}

// --- cookies ------------------------------------------------------------
async function readGoogleCookies() {
  // domain:"google.com" matche google.com + tous ses sous-domaines
  // (accounts., gemini., etc.) en une seule requete.
  const raw = await chrome.cookies.getAll({ domain: "google.com" });
  return raw.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite === "unspecified" ? null : c.sameSite,
    hostOnly: c.hostOnly,
    session: c.session,
    expirationDate: c.expirationDate,
  }));
}

function hasRequired(cookies) {
  const names = new Set(cookies.map((c) => c.name));
  return KEY_COOKIES.every((n) => names.has(n));
}

async function setStatus(patch) {
  const { lastCookieSync = {} } = await chrome.storage.local.get("lastCookieSync");
  await chrome.storage.local.set({ lastCookieSync: { ...lastCookieSync, ...patch } });
}

async function doSync(reason) {
  const settings = await getSettings();
  if (!settings.cookieSync) return { ok: false, skipped: true };

  const cookies = await readGoogleCookies();
  if (!hasRequired(cookies)) {
    await setStatus({ ok: false, error: "session incomplete (1PSID/1PSIDTS absent)", at: nowIso(), reason });
    return { ok: false, error: "missing-required" };
  }

  try {
    const res = await fetch(settings.receiverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cookies),
    });
    const body = await res.json().catch(() => ({}));
    const ok = res.ok && body.ok !== false;
    await setStatus({ ok, count: cookies.length, at: nowIso(), reason, error: ok ? null : (body.error || `HTTP ${res.status}`) });
    return { ok, count: cookies.length, remote: body };
  } catch (err) {
    await setStatus({ ok: false, count: cookies.length, at: nowIso(), reason, error: `recepteur injoignable: ${err.message}` });
    return { ok: false, error: String(err) };
  }
}

function nowIso() {
  // Date is allowed in a service worker (not in the workflow sandbox).
  return new Date().toISOString();
}

// --- scheduling ---------------------------------------------------------
async function ensureAlarms() {
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (!existing) await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MIN, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  await chrome.storage.sync.set({ ...DEFAULTS, ...current });
  await ensureAlarms();
  await doSync("install");
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarms();
  await doSync("startup");
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM || alarm.name === DEBOUNCE_ALARM) {
    await doSync(alarm.name === DEBOUNCE_ALARM ? "cookie-change" : "periodic");
  }
});

// Quand un cookie de session change (rotation du 1PSIDTS notamment), on
// programme une synchro debouncee a +1 min (regroupe les rafales).
chrome.cookies.onChanged.addListener(async (info) => {
  if (!KEY_COOKIES.includes(info.cookie.name)) return;
  if (!(info.cookie.domain || "").includes("google.com")) return;
  await chrome.alarms.create(DEBOUNCE_ALARM, { delayInMinutes: 1 });
});

// --- messages (depuis le popup) ----------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg && msg.type === "bxc-sync-cookies-now") {
      const r = await doSync("manual");
      sendResponse(r);
      return;
    }
    if (msg && msg.type === "bxc-cookie-status") {
      const { lastCookieSync = null } = await chrome.storage.local.get("lastCookieSync");
      sendResponse({ status: lastCookieSync });
      return;
    }
    sendResponse({ ok: true });
  })();
  return true; // async response
});
