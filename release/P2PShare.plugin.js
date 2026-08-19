/**
 * @name P2PShare
 * @author Andrew
 * @description Compartilhamento de tela ponto-a-ponto via WebRTC, sem passar pela infra de video do Discord e sem servidor proprio.
 * @version 1.1.1
 * @source https://github.com/andrewmautone/discord-p2pshare
 */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// bd-entry.ts
var bd_entry_exports = {};
__export(bd_entry_exports, {
  default: () => P2PShare
});
module.exports = __toCommonJS(bd_entry_exports);

// capture.ts
var CaptureError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "CaptureError";
  }
};
var defaultDeps = {
  getDisplayMedia: (c) => navigator.mediaDevices.getDisplayMedia(c),
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  getSources: async () => {
    const native = window.DiscordNative?.desktopCapture;
    if (!native?.getDesktopCaptureSources) {
      throw new Error("DiscordNative.desktopCapture indispon\xEDvel");
    }
    return native.getDesktopCaptureSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 }
    });
  },
  // Sem seletor injetado, transmite a primeira fonte (a tela principal).
  pickSource: async (sources) => sources[0]?.id ?? null
};
async function captureScreen(deps = {}) {
  const d = { ...defaultDeps, ...deps };
  let sources = [];
  try {
    sources = await d.getSources();
  } catch (err) {
    console.warn("[P2PShare] DiscordNative indispon\xEDvel, tentando getDisplayMedia", err);
  }
  if (sources.length) {
    const sourceId = await d.pickSource(sources);
    if (!sourceId) throw new CaptureError("captura cancelada pelo usu\xE1rio");
    const video = {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxFrameRate: 60
      }
    };
    try {
      return await d.getUserMedia({
        audio: { mandatory: { chromeMediaSource: "desktop" } },
        video
      });
    } catch (err) {
      console.warn("[P2PShare] sem \xE1udio do sistema, transmitindo s\xF3 v\xEDdeo", err);
    }
    try {
      return await d.getUserMedia({ audio: false, video });
    } catch (err) {
      throw new CaptureError(`falha ao capturar a fonte: ${err.message}`);
    }
  }
  try {
    return await d.getDisplayMedia({
      video: { frameRate: { ideal: 60 } },
      audio: true
    });
  } catch (err) {
    throw new CaptureError(
      `nenhuma API de captura de tela dispon\xEDvel: ${err.message}`
    );
  }
}

// constants.ts
var PROTOCOL_VERSION = 1;
var PLUGIN_URL = "https://github.com/andrewmautone/discord-p2pshare";
var PLUGIN_VERSION = "1.1.1";
var UPDATE_URL = "https://raw.githubusercontent.com/andrewmautone/discord-p2pshare/main/release/P2PShare.plugin.js";
var ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" }
];
var ZW_CODEPOINTS = [8203, 8204, 8205, 8288];
var ZW_DIGITS = ZW_CODEPOINTS.map((c) => String.fromCodePoint(c));
var ZW_DELIM = String.fromCodePoint(8290);
var MIN_BITRATE = 8e5;
var MAX_BITRATE = 8e6;
var DEFAULT_BUDGET_MBPS = 15;
var ICE_GATHER_TIMEOUT_MS = 4e3;
var PEER_CONNECT_TIMEOUT_MS = 3e4;
var HANDSHAKE_TTL_MS = 2e4;

// codec.ts
var DIGIT_INDEX = new Map(ZW_DIGITS.map((c, i) => [c, i]));
function encodeZeroWidth(text) {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (const byte of bytes) {
    out += ZW_DIGITS[byte >> 6 & 3];
    out += ZW_DIGITS[byte >> 4 & 3];
    out += ZW_DIGITS[byte >> 2 & 3];
    out += ZW_DIGITS[byte & 3];
  }
  return out;
}
function decodeZeroWidth(zw) {
  const chars = [...zw];
  if (chars.length % 4 !== 0) throw new Error("comprimento zero-width inv\xE1lido");
  const bytes = new Uint8Array(chars.length / 4);
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0;
    for (let j = 0; j < 4; j++) {
      const digit = DIGIT_INDEX.get(chars[i * 4 + j]);
      if (digit === void 0) throw new Error("caractere zero-width inv\xE1lido");
      byte = byte << 2 | digit;
    }
    bytes[i] = byte;
  }
  return new TextDecoder().decode(bytes);
}
function embedPayload(visible, payload) {
  return visible + ZW_DELIM + encodeZeroWidth(JSON.stringify(payload)) + ZW_DELIM;
}
function extractPayload(content) {
  const start = content.indexOf(ZW_DELIM);
  if (start === -1) return null;
  const end = content.indexOf(ZW_DELIM, start + 1);
  if (end === -1) return null;
  try {
    return JSON.parse(decodeZeroWidth(content.slice(start + 1, end)));
  } catch {
    return null;
  }
}
function formatHandshakeName(n) {
  return `p2p.${n.sessionId}.${n.kind}.${n.targetUserId}.txt`;
}
function parseHandshakeName(filename) {
  const parts2 = filename.split(".");
  if (parts2.length !== 5) return null;
  const [prefix, sessionId, kind, targetUserId, ext] = parts2;
  if (prefix !== "p2p" || ext !== "txt") return null;
  if (kind !== "offer" && kind !== "answer") return null;
  if (!sessionId || !targetUserId) return null;
  return { sessionId, kind, targetUserId };
}
function newSessionId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => (b % 36).toString(36)).join("");
}

// host/bd/api.ts
var { getModule } = BdApi.Webpack;
function find(name, filter) {
  let cached;
  return () => {
    if (cached !== void 0) return cached;
    cached = getModule(filter);
    if (cached === void 0) {
      cached = getModule(filter, { searchExports: true });
    }
    if (cached === void 0) {
      const wrapper = getModule((m) => m?.default && filter(m.default));
      if (wrapper) cached = wrapper.default;
    }
    if (cached === void 0 || cached === null) {
      throw new Error(
        `[P2PShare] n\xE3o encontrei o m\xF3dulo ${name} no Discord. Provavelmente o Discord mudou a estrutura interna \u2014 reporte com este nome.`
      );
    }
    return cached;
  };
}
var UserStore = find(
  "UserStore",
  (m) => m?.getCurrentUser && m?.getUser
);
var SelectedChannelStore = find(
  "SelectedChannelStore",
  (m) => m?.getVoiceChannelId && m?.getChannelId
);
var FluxDispatcher = find(
  "FluxDispatcher",
  (m) => m?.dispatch && m?.subscribe && m?.unsubscribe
);
var RestAPI = find(
  "RestAPI",
  (m) => typeof m === "object" && m?.del && m?.put && m?.post
);
var CloudUpload = find(
  "CloudUpload",
  (m) => m?.prototype?.trackUploadFinished
);
function nonce() {
  const DISCORD_EPOCH = 1420070400000n;
  return (BigInt(Date.now()) - DISCORD_EPOCH << 22n).toString();
}
function getCurrentUserId() {
  return UserStore().getCurrentUser().id;
}
function getCurrentUsername() {
  return UserStore().getCurrentUser().username;
}
function getUsername(userId) {
  try {
    const user = UserStore().getUser(userId);
    return user?.globalName || user?.username || userId;
  } catch {
    return userId;
  }
}
function getVoiceChannelId() {
  return SelectedChannelStore().getVoiceChannelId() ?? null;
}
async function sendMessage(channelId, content) {
  const res = await RestAPI().post({
    url: `/channels/${channelId}/messages`,
    body: {
      channel_id: channelId,
      content,
      nonce: nonce(),
      sticker_ids: [],
      type: 0
    }
  });
  return res.body.id;
}
var dmCache = /* @__PURE__ */ new Map();
async function openDm(userId) {
  const cached = dmCache.get(userId);
  if (cached) return cached;
  try {
    const res = await RestAPI().post({
      url: "/users/@me/channels",
      body: { recipient_id: userId }
    });
    const id = res.body?.id;
    if (!id) return null;
    dmCache.set(userId, id);
    return id;
  } catch (err) {
    console.warn("[P2PShare] n\xE3o deu para abrir DM", err);
    return null;
  }
}
async function deleteMessage(channelId, messageId) {
  await RestAPI().del({ url: `/channels/${channelId}/messages/${messageId}` });
}
function uploadTextAttachment(channelId, filename, text, content) {
  return new Promise((resolve, reject) => {
    const Upload = CloudUpload();
    const upload = new Upload({
      file: new File([text], filename, { type: "text/plain" }),
      isThumbnail: false,
      platform: 1
    }, channelId);
    upload.on("complete", () => {
      RestAPI().post({
        url: `/channels/${channelId}/messages`,
        body: {
          channel_id: channelId,
          content,
          nonce: nonce(),
          sticker_ids: [],
          type: 0,
          attachments: [{
            id: "0",
            filename: upload.filename,
            uploaded_filename: upload.uploadedFilename
          }]
        }
      }).then(() => resolve(), reject);
    });
    upload.on("error", () => reject(new Error("falha ao subir o anexo")));
    upload.upload();
  });
}
async function fetchAttachmentText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`anexo respondeu ${res.status}`);
  return res.text();
}
function onMessageCreate(handler) {
  const listener = (event) => {
    try {
      handler(event.message);
    } catch (err) {
      console.error("[P2PShare] handler de MESSAGE_CREATE falhou", err);
    }
  };
  FluxDispatcher().subscribe("MESSAGE_CREATE", listener);
  return () => FluxDispatcher().unsubscribe("MESSAGE_CREATE", listener);
}
function onMessageDelete(handler) {
  const listener = (event) => {
    try {
      handler(event.channelId, event.id);
    } catch (err) {
      console.error("[P2PShare] handler de MESSAGE_DELETE falhou", err);
    }
  };
  FluxDispatcher().subscribe("MESSAGE_DELETE", listener);
  return () => FluxDispatcher().unsubscribe("MESSAGE_DELETE", listener);
}

// host/bd/settings.ts
var STORE = "P2PShare";
function loadSetting(key, fallback) {
  const value = BdApi.Data.load(STORE, key);
  return value === void 0 || value === null ? fallback : value;
}
function saveSetting(key, value) {
  BdApi.Data.save(STORE, key, value);
}

// host/bd/ui.ts
var ui_exports = {};
__export(ui_exports, {
  announceBeacon: () => announceBeacon,
  injectStyles: () => injectStyles,
  mountLauncher: () => mountLauncher,
  mountOverlay: () => mountOverlay,
  mountVoiceButton: () => mountVoiceButton,
  openSourcePicker: () => openSourcePicker,
  removeStyles: () => removeStyles,
  revokeBeacon: () => revokeBeacon,
  setLauncherHidden: () => setLauncherHidden,
  setOverlayViewers: () => setOverlayViewers,
  unmountAllOverlays: () => unmountAllOverlays,
  unmountLauncher: () => unmountLauncher,
  unmountOverlay: () => unmountOverlay,
  updateLauncher: () => updateLauncher,
  updateVoiceButton: () => updateVoiceButton
});
var CSS = `
.p2ps-launcher {
    position: fixed;
    z-index: 4000;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--background-floating, #18191c);
    box-shadow: 0 4px 12px rgb(0 0 0 / 40%);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--interactive-normal, #b9bbbe);
    user-select: none;
}
.p2ps-launcher:hover { color: var(--interactive-hover, #fff); }
.p2ps-launcher-live { color: var(--status-danger, #ed4245); }
.p2ps-launcher svg { width: 22px; height: 22px; pointer-events: none; }
.p2ps-launcher-count {
    position: absolute;
    bottom: -2px;
    right: -2px;
    background: var(--status-danger, #ed4245);
    color: #fff;
    border-radius: 8px;
    font-size: 11px;
    line-height: 16px;
    min-width: 16px;
    text-align: center;
    padding: 0 4px;
}

.p2ps-backdrop {
    position: fixed;
    inset: 0;
    z-index: 4100;
    background: rgb(0 0 0 / 70%);
    display: flex;
    align-items: center;
    justify-content: center;
}
.p2ps-dialog {
    background: var(--background-primary, #36393f);
    border-radius: 8px;
    width: min(900px, 90vw);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    color: var(--header-primary, #fff);
}
.p2ps-dialog-head { padding: 16px; font-size: 18px; font-weight: 600; }
.p2ps-dialog-body { padding: 0 16px; overflow-y: auto; flex: 1; }
.p2ps-dialog-foot {
    padding: 16px;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    background: var(--background-secondary, #2f3136);
    border-radius: 0 0 8px 8px;
}
.p2ps-btn {
    padding: 8px 16px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 14px;
    color: #fff;
    background: var(--brand-experiment, #5865f2);
}
.p2ps-btn-secondary { background: transparent; }
.p2ps-btn:disabled { opacity: .5; cursor: not-allowed; }
.p2ps-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.p2ps-tab {
    padding: 6px 12px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    background: var(--background-secondary, #2f3136);
    color: var(--interactive-normal, #b9bbbe);
    font-size: 13px;
}
.p2ps-tab-active { background: var(--brand-experiment, #5865f2); color: #fff; }

.p2ps-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    padding-bottom: 12px;
}
.p2ps-card {
    border: 2px solid transparent;
    border-radius: 8px;
    padding: 6px;
    cursor: pointer;
    background: var(--background-secondary, #2f3136);
}
.p2ps-card:hover { background: var(--background-modifier-hover, #3a3c43); }
.p2ps-card-selected { border-color: var(--brand-experiment, #5865f2); }
.p2ps-card-thumb {
    aspect-ratio: 16/9;
    background: #000;
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted, #72767d);
    font-size: 12px;
}
.p2ps-card-thumb img { width: 100%; height: 100%; object-fit: contain; }
.p2ps-card-name {
    margin-top: 6px;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.p2ps-overlay {
    position: fixed;
    z-index: 4000;
    background: var(--background-tertiary, #202225);
    border-radius: 8px;
    box-shadow: 0 8px 16px rgb(0 0 0 / 40%);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    resize: both;
    min-width: 240px;
    min-height: 160px;
}
.p2ps-overlay-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    cursor: move;
    background: var(--background-secondary-alt, #292b2f);
    color: var(--header-primary, #fff);
    font-size: 13px;
    user-select: none;
}
.p2ps-overlay-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p2ps-live {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--status-danger, #ed4245);
    color: #fff;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .06em;
    flex-shrink: 0;
}
.p2ps-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #fff;
    animation: p2ps-pulse 2s ease-in-out infinite;
}
@keyframes p2ps-pulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
@media (prefers-reduced-motion: reduce) { .p2ps-live-dot { animation: none } }
.p2ps-vol { width: 64px; accent-color: var(--brand-experiment, #5865f2); }
.p2ps-viewers {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 7px 9px;
    background: var(--background-secondary-alt, #292b2f);
    border-top: 1px solid var(--background-tertiary, #202225);
    font-size: 12px;
}
.p2ps-viewers-label {
    color: var(--text-muted, #72767d);
    text-transform: uppercase;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .06em;
}
.p2ps-viewer-chip {
    background: var(--background-tertiary, #202225);
    color: var(--header-primary, #fff);
    border-radius: 10px;
    padding: 2px 9px;
}
.p2ps-overlay-bar button:disabled { opacity: .4; cursor: default; }
.p2ps-voice-btn { position: relative; }
.p2ps-voice-count {
    position: absolute;
    bottom: 0;
    right: 0;
    background: var(--status-danger, #ed4245);
    color: #fff;
    border-radius: 8px;
    font-size: 10px;
    line-height: 14px;
    min-width: 14px;
    text-align: center;
    padding: 0 3px;
    pointer-events: none;
}
.p2ps-launcher-hidden { display: none; }
.p2ps-overlay-bar button {
    background: none;
    border: none;
    color: var(--interactive-normal, #b9bbbe);
    cursor: pointer;
    font-size: 13px;
}
.p2ps-overlay video { flex: 1; width: 100%; background: #000; object-fit: contain; }
`;
var SCREENSHARE_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 4.5C2 3.397 2.897 2.5 4 2.5H20C21.103 2.5 22 3.397 22 4.5V15.5C22 16.604 21.103 17.5 20 17.5H13V19.5H17V21.5H7V19.5H11V17.5H4C2.897 17.5 2 16.604 2 15.5V4.5ZM13.2 14.3375V11.6C9.864 11.6 7.668 12.6625 6 15C6.672 11.6625 8.532 8.3375 13.2 7.6625V5L18 9.6625L13.2 14.3375Z"/></svg>';
function injectStyles() {
  BdApi.DOM.addStyle("P2PShare", CSS);
}
function removeStyles() {
  BdApi.DOM.removeStyle("P2PShare");
}
function makeDraggable(el, handle, onDrop) {
  let offset = null;
  handle.addEventListener("mousedown", (e) => {
    const rect = el.getBoundingClientRect();
    offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  });
  const move = (e) => {
    if (!offset) return;
    el.style.left = `${e.clientX - offset.x}px`;
    el.style.top = `${e.clientY - offset.y}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  };
  const up = () => {
    if (!offset) return;
    offset = null;
    onDrop?.();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  el.__p2psCleanupDrag = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
}
var launcher = null;
function mountLauncher(opts) {
  unmountLauncher();
  const el = document.createElement("div");
  el.className = "p2ps-launcher";
  el.title = "Transmitir tela via P2P";
  el.innerHTML = SCREENSHARE_SVG;
  el.style.left = `${opts.position.x}px`;
  el.style.top = `${opts.position.y}px`;
  let moved = false;
  el.addEventListener("mousedown", () => {
    moved = false;
  });
  el.addEventListener("mousemove", (e) => {
    if (e.buttons) moved = true;
  });
  el.addEventListener("click", () => {
    if (!moved) opts.onToggle();
  });
  makeDraggable(el, el, () => {
    opts.onMoved({ x: parseInt(el.style.left, 10), y: parseInt(el.style.top, 10) });
  });
  document.body.appendChild(el);
  launcher = el;
}
function updateLauncher(state) {
  if (!launcher) return;
  launcher.classList.toggle("p2ps-launcher-live", state.active);
  launcher.title = state.active ? `Parar transmiss\xE3o P2P \u2014 ${state.viewers} assistindo` : "Transmitir tela via P2P";
  launcher.querySelector(".p2ps-launcher-count")?.remove();
  if (state.active && state.viewers > 0) {
    const badge = document.createElement("span");
    badge.className = "p2ps-launcher-count";
    badge.textContent = String(state.viewers);
    launcher.appendChild(badge);
  }
}
function setLauncherHidden(hidden) {
  launcher?.classList.toggle("p2ps-launcher-hidden", hidden);
}
function unmountLauncher() {
  if (!launcher) return;
  launcher.__p2psCleanupDrag?.();
  launcher.remove();
  launcher = null;
}
var voiceBtn = null;
var voiceObserver = null;
var lastState = { active: false, viewers: 0 };
function findShareButton() {
  const isOurs = (el) => !!el?.classList.contains("p2ps-voice-btn");
  for (const path of document.querySelectorAll('button svg path[d^="M2 4.5C2 3.397"]')) {
    const btn = path.closest("button");
    if (btn && !isOurs(btn)) return btn;
  }
  for (const btn of document.querySelectorAll("button[aria-label]")) {
    if (isOurs(btn)) continue;
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("tela") || label.includes("screen") || label.includes("share")) {
      return btn;
    }
  }
  return null;
}
function paintVoiceButton() {
  if (!voiceBtn) return;
  const svg = voiceBtn.querySelector("svg");
  if (svg) {
    svg.style.color = lastState.active ? "var(--status-danger, #ed4245)" : "";
  }
  voiceBtn.setAttribute(
    "aria-label",
    lastState.active ? `Parar transmiss\xE3o P2P \u2014 ${lastState.viewers} assistindo` : "Transmitir tela via P2P"
  );
  voiceBtn.title = voiceBtn.getAttribute("aria-label") || "";
  voiceBtn.querySelector(".p2ps-voice-count")?.remove();
  if (lastState.active && lastState.viewers > 0) {
    const badge = document.createElement("span");
    badge.className = "p2ps-voice-count";
    badge.textContent = String(lastState.viewers);
    voiceBtn.appendChild(badge);
  }
}
function mountVoiceButton(opts) {
  const sync = () => {
    const anchor = findShareButton();
    if (!anchor) {
      voiceBtn?.remove();
      voiceBtn = null;
      opts.onAnchorChange(false);
      return;
    }
    if (voiceBtn && voiceBtn.isConnected && voiceBtn.previousElementSibling === anchor) {
      opts.onAnchorChange(true);
      return;
    }
    voiceBtn?.remove();
    const btn = document.createElement("button");
    btn.className = `${anchor.className} p2ps-voice-btn`;
    btn.type = "button";
    btn.innerHTML = SCREENSHARE_SVG;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      opts.onToggle();
    });
    anchor.insertAdjacentElement("afterend", btn);
    voiceBtn = btn;
    paintVoiceButton();
    opts.onAnchorChange(true);
  };
  sync();
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  };
  voiceObserver = new MutationObserver(schedule);
  voiceObserver.observe(document.body, { childList: true, subtree: true });
  return () => {
    voiceObserver?.disconnect();
    voiceObserver = null;
    voiceBtn?.remove();
    voiceBtn = null;
  };
}
function updateVoiceButton(state) {
  lastState = state;
  paintVoiceButton();
}
function thumbnailOf(source) {
  const raw = source;
  for (const key of ["thumbnail", "url", "image"]) {
    const value = raw[key];
    if (typeof value === "string" && value.startsWith("data:")) return value;
    if (value && typeof value.toDataURL === "function") {
      try {
        return value.toDataURL();
      } catch {
      }
    }
  }
  return null;
}
var isScreen = (s) => s.id.startsWith("screen:");
function openSourcePicker(sources) {
  return new Promise((resolve) => {
    let selected = null;
    let tab = sources.some(isScreen) ? "screen" : "window";
    const backdrop = document.createElement("div");
    backdrop.className = "p2ps-backdrop";
    backdrop.innerHTML = `
            <div class="p2ps-dialog">
                <div class="p2ps-dialog-head">Compartilhar via P2P</div>
                <div class="p2ps-dialog-body">
                    <div class="p2ps-tabs">
                        <button class="p2ps-tab" data-tab="screen">Tela inteira</button>
                        <button class="p2ps-tab" data-tab="window">Aplicativos</button>
                    </div>
                    <div class="p2ps-grid"></div>
                </div>
                <div class="p2ps-dialog-foot">
                    <button class="p2ps-btn p2ps-btn-secondary" data-act="cancel">Cancelar</button>
                    <button class="p2ps-btn" data-act="ok" disabled>Transmitir</button>
                </div>
            </div>`;
    const grid = backdrop.querySelector(".p2ps-grid");
    const okBtn = backdrop.querySelector('[data-act="ok"]');
    let settled = false;
    const settle = (id) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(id);
    };
    const onKey = (e) => {
      if (e.key === "Escape") settle(null);
    };
    const render = () => {
      for (const btn of backdrop.querySelectorAll(".p2ps-tab")) {
        btn.classList.toggle("p2ps-tab-active", btn.dataset.tab === tab);
      }
      grid.innerHTML = "";
      const shown = sources.filter((s) => tab === "screen" ? isScreen(s) : !isScreen(s));
      if (!shown.length) {
        grid.textContent = "Nenhuma fonte encontrada nesta aba.";
        return;
      }
      for (const source of shown) {
        const thumb = thumbnailOf(source);
        const card = document.createElement("div");
        card.className = "p2ps-card" + (selected === source.id ? " p2ps-card-selected" : "");
        const thumbEl = document.createElement("div");
        thumbEl.className = "p2ps-card-thumb";
        if (thumb) {
          const img = document.createElement("img");
          img.src = thumb;
          thumbEl.appendChild(img);
        } else {
          thumbEl.textContent = "sem pr\xE9via";
        }
        const nameEl = document.createElement("div");
        nameEl.className = "p2ps-card-name";
        nameEl.textContent = source.name;
        nameEl.title = source.name;
        card.append(thumbEl, nameEl);
        card.addEventListener("click", () => {
          selected = source.id;
          okBtn.disabled = false;
          render();
        });
        card.addEventListener("dblclick", () => settle(source.id));
        grid.appendChild(card);
      }
    };
    for (const btn of backdrop.querySelectorAll(".p2ps-tab")) {
      btn.addEventListener("click", () => {
        tab = btn.dataset.tab;
        selected = null;
        okBtn.disabled = true;
        render();
      });
    }
    okBtn.addEventListener("click", () => settle(selected));
    backdrop.querySelector('[data-act="cancel"]').addEventListener("click", () => settle(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) settle(null);
    });
    document.addEventListener("keydown", onKey);
    render();
    document.body.appendChild(backdrop);
  });
}
var overlays = /* @__PURE__ */ new Map();
function mountOverlay(sessionId, stream, title, onClose, opts = {}) {
  unmountOverlay(sessionId);
  const el = document.createElement("div");
  el.className = "p2ps-overlay";
  el.style.left = "80px";
  el.style.top = "80px";
  el.style.width = "640px";
  el.innerHTML = `
        <div class="p2ps-overlay-bar">
            <span class="p2ps-live"><span class="p2ps-live-dot"></span>AO VIVO</span>
            <span class="p2ps-overlay-title"></span>
            <button data-act="mute" title="Silenciar"></button>
            <input class="p2ps-vol" type="range" min="0" max="100" value="100" title="Volume">
            <button data-act="full" title="Tela cheia">\u26F6</button>
            <button data-act="close">\u2715</button>
        </div>
        <video autoplay playsinline></video>
        <div class="p2ps-viewers" hidden></div>`;
  el.querySelector(".p2ps-overlay-title").textContent = title;
  const video = el.querySelector("video");
  video.srcObject = stream;
  video.muted = opts.muted === true;
  const muteBtn = el.querySelector('[data-act="mute"]');
  const vol = el.querySelector(".p2ps-vol");
  const paintAudio = () => {
    muteBtn.textContent = video.muted || video.volume === 0 ? "\u{1F507}" : "\u{1F50A}";
  };
  if (opts.muted) {
    muteBtn.disabled = true;
    vol.disabled = true;
    muteBtn.title = "A previa da sua tela fica sempre muda";
  } else {
    muteBtn.addEventListener("click", () => {
      video.muted = !video.muted;
      paintAudio();
    });
    vol.addEventListener("input", () => {
      video.volume = Number(vol.value) / 100;
      video.muted = video.volume === 0;
      paintAudio();
    });
  }
  paintAudio();
  el.querySelector('[data-act="full"]').addEventListener("click", () => {
    void video.requestFullscreen();
  });
  const closeBtn = el.querySelector('[data-act="close"]');
  closeBtn.title = opts.closeLabel ?? "Fechar";
  closeBtn.addEventListener("click", onClose);
  makeDraggable(el, el.querySelector(".p2ps-overlay-bar"));
  document.body.appendChild(el);
  overlays.set(sessionId, el);
}
function setOverlayViewers(sessionId, names) {
  const el = overlays.get(sessionId);
  if (!el) return;
  const bar = el.querySelector(".p2ps-viewers");
  if (!bar) return;
  if (!names.length) {
    bar.hidden = true;
    bar.textContent = "";
    return;
  }
  bar.hidden = false;
  bar.textContent = "";
  const label = document.createElement("span");
  label.className = "p2ps-viewers-label";
  label.textContent = names.length === 1 ? "Assistindo" : `Assistindo (${names.length})`;
  bar.appendChild(label);
  for (const name of names) {
    const chip = document.createElement("span");
    chip.className = "p2ps-viewer-chip";
    chip.textContent = name;
    bar.appendChild(chip);
  }
}
function unmountOverlay(sessionId) {
  const el = overlays.get(sessionId);
  if (!el) return;
  el.__p2psCleanupDrag?.();
  const video = el.querySelector("video");
  if (video) video.srcObject = null;
  el.remove();
  overlays.delete(sessionId);
}
function unmountAllOverlays() {
  for (const sessionId of [...overlays.keys()]) unmountOverlay(sessionId);
}
var notices = /* @__PURE__ */ new Map();
function announceBeacon(notice, onWatch) {
  revokeBeacon(notice.sessionId);
  const close = BdApi.UI.showNotice(
    `${notice.broadcasterName} est\xE1 transmitindo a tela via P2P.`,
    {
      type: "info",
      buttons: [{
        label: "Assistir",
        onClick: () => {
          onWatch();
          revokeBeacon(notice.sessionId);
        }
      }]
    }
  );
  notices.set(notice.sessionId, close);
}
function revokeBeacon(sessionId) {
  const close = notices.get(sessionId);
  if (!close) return;
  notices.delete(sessionId);
  try {
    close();
  } catch {
  }
}

// host/bd/index.ts
var TOAST_TYPE = {
  info: "info",
  success: "success",
  error: "error"
};
var host = {
  getCurrentUserId,
  getCurrentUsername,
  getUsername,
  getVoiceChannelId,
  sendMessage,
  deleteMessage,
  uploadTextAttachment,
  fetchAttachmentText,
  openDm,
  onMessageCreate,
  onMessageDelete,
  toast: (message, kind) => BdApi.UI.showToast(message, { type: TOAST_TYPE[kind] }),
  getBudgetMbps: () => loadSetting("uploadBudgetMbps", DEFAULT_BUDGET_MBPS),
  pickSource: openSourcePicker,
  mountOverlay,
  unmountOverlay,
  unmountAllOverlays,
  setOverlayViewers,
  announceBeacon,
  revokeBeacon
};

// bitrate.ts
function computePerPeerBitrate(budgetMbps, viewerCount) {
  if (viewerCount <= 0) return MAX_BITRATE;
  const perPeer = budgetMbps * 1e6 / viewerCount;
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, perPeer)));
}

// peers.ts
var defaultFactory = (config) => new RTCPeerConnection(config);
var PEER_CONFIG = { iceServers: ICE_SERVERS };
function waitForIceGathering(pc, timeoutMs = ICE_GATHER_TIMEOUT_MS) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      pc.onicegatheringstatechange = null;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
  });
}
var BroadcastPeers = class {
  constructor(stream, transport, opts) {
    this.stream = stream;
    this.transport = transport;
    this.budgetMbps = opts.budgetMbps;
    this.createPeer = opts.createPeer ?? defaultFactory;
  }
  stream;
  transport;
  peers = /* @__PURE__ */ new Map();
  createPeer;
  budgetMbps;
  onCountChange;
  get viewerCount() {
    return this.peers.size;
  }
  /** Ids de quem está conectado agora, para o emissor saber quem é. */
  get viewerIds() {
    return [...this.peers.keys()];
  }
  async handleOffer(fromUserId, sdp) {
    this.peers.get(fromUserId)?.close();
    const pc = this.createPeer(PEER_CONFIG);
    this.peers.set(fromUserId, pc);
    for (const track of this.stream.getTracks()) {
      pc.addTrack(track, this.stream);
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.removePeer(fromUserId);
      }
    };
    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGathering(pc);
    this.applyBitrate();
    this.onCountChange?.(this.peers.size);
    await this.transport.send("answer", fromUserId, pc.localDescription?.sdp ?? answer.sdp);
  }
  removePeer(userId) {
    const pc = this.peers.get(userId);
    if (!pc) return;
    this.peers.delete(userId);
    pc.onconnectionstatechange = null;
    pc.close();
    this.applyBitrate();
    this.onCountChange?.(this.peers.size);
  }
  closeAll() {
    for (const pc of this.peers.values()) {
      pc.onconnectionstatechange = null;
      pc.close();
    }
    this.peers.clear();
    this.onCountChange?.(0);
  }
  /** Redistribui o orçamento de upload entre todos os viewers atuais. */
  applyBitrate() {
    const maxBitrate = computePerPeerBitrate(this.budgetMbps, this.peers.size);
    for (const pc of this.peers.values()) {
      for (const sender of pc.getSenders()) {
        if (!sender.track) continue;
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = maxBitrate;
        params.degradationPreference = "maintain-framerate";
        sender.setParameters(params).catch((err) => console.warn("[P2PShare] n\xE3o deu para aplicar o bitrate", err));
      }
    }
  }
};
var ViewerPeer = class {
  constructor(transport, broadcasterId, opts = {}) {
    this.transport = transport;
    this.broadcasterId = broadcasterId;
    this.opts = opts;
  }
  transport;
  broadcasterId;
  opts;
  pc = null;
  connectTimer = null;
  onStream;
  onFailed;
  async start() {
    const pc = (this.opts.createPeer ?? defaultFactory)(PEER_CONFIG);
    this.pc = pc;
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        this.clearTimer();
        this.onStream?.(stream);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.clearTimer();
      if (pc.connectionState === "failed") {
        this.fail(
          "a conex\xE3o P2P falhou \u2014 prov\xE1vel NAT sim\xE9trico (CGNAT). Sem TURN n\xE3o tem como conectar"
        );
      }
    };
    this.connectTimer = setTimeout(
      () => this.fail(
        "tempo esgotado esperando a conex\xE3o \u2014 prov\xE1vel NAT sim\xE9trico (CGNAT)"
      ),
      PEER_CONNECT_TIMEOUT_MS
    );
    const offer2 = await pc.createOffer();
    await pc.setLocalDescription(offer2);
    await waitForIceGathering(pc);
    await this.transport.send("offer", this.broadcasterId, pc.localDescription?.sdp ?? offer2.sdp);
  }
  async handleAnswer(sdp) {
    if (!this.pc) return;
    await this.pc.setRemoteDescription({ type: "answer", sdp });
  }
  close() {
    this.clearTimer();
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
  }
  clearTimer() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }
  fail(reason) {
    this.clearTimer();
    this.onFailed?.(reason);
  }
};

// beacon.ts
function beaconContent(sessionId, username) {
  const visible = `\u{1F534} **${username}** est\xE1 transmitindo a tela via P2P.
Instale o plugin para assistir: ${PLUGIN_URL}`;
  return embedPayload(visible, { v: PROTOCOL_VERSION, s: sessionId });
}
function parseBeacon(message) {
  const payload = extractPayload(message.content);
  if (!payload || payload.v !== PROTOCOL_VERSION) return null;
  if (typeof payload.s !== "string") return null;
  if (payload.k !== void 0) return null;
  return {
    messageId: message.id,
    channelId: message.channel_id,
    sessionId: payload.s,
    broadcasterId: message.author.id,
    broadcasterName: message.author.username
  };
}
function handshakeMarker(sessionId, kind) {
  return embedPayload("", { v: PROTOCOL_VERSION, s: sessionId, k: kind });
}
function handshakeBody(kind, sdp) {
  return JSON.stringify({ v: PROTOCOL_VERSION, type: kind, sdp });
}
function parseHandshakeBody(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (body?.v !== PROTOCOL_VERSION) return null;
  if (body.type !== "offer" && body.type !== "answer") return null;
  if (typeof body.sdp !== "string") return null;
  return { kind: body.type, sdp: body.sdp };
}

// handshake.ts
async function deliverHandshake(sender, payload) {
  const { fallbackChannelId, targetUserId, filename, body, marker } = payload;
  try {
    const dm = await sender.openDm(targetUserId);
    if (dm) {
      await sender.upload(dm, filename, body, marker);
      return "dm";
    }
  } catch (err) {
    console.warn("[P2PShare] DM indispon\xEDvel, usando o canal", err);
  }
  await sender.upload(fallbackChannelId, filename, body, marker);
  return "channel";
}

// signaling.ts
function postBeacon(channelId, sessionId, username) {
  return host.sendMessage(channelId, beaconContent(sessionId, username));
}
function removeBeacon(channelId, messageId) {
  return host.deleteMessage(channelId, messageId);
}
async function sendHandshake(channelId, sessionId, kind, targetUserId, sdp) {
  const via = await deliverHandshake(
    {
      openDm: host.openDm,
      upload: host.uploadTextAttachment
    },
    {
      fallbackChannelId: channelId,
      targetUserId,
      filename: formatHandshakeName({ sessionId, kind, targetUserId }),
      body: handshakeBody(kind, sdp),
      marker: handshakeMarker(sessionId, kind)
    }
  );
  if (via === "channel") {
    console.info("[P2PShare] handshake foi pelo canal: DM indispon\xEDvel");
  }
}
function observeSignals(handlers) {
  const myId = host.getCurrentUserId();
  const unsubCreate = host.onMessageCreate((message) => {
    const beacon = parseBeacon(message);
    if (beacon) {
      handlers.onBeacon?.(beacon);
      return;
    }
    for (const attachment of message.attachments ?? []) {
      const name = parseHandshakeName(attachment.filename);
      if (!name) continue;
      if (message.author.id === myId) {
        setTimeout(() => {
          host.deleteMessage(message.channel_id, message.id).catch(() => {
          });
        }, HANDSHAKE_TTL_MS);
        continue;
      }
      if (name.targetUserId !== myId) continue;
      host.fetchAttachmentText(attachment.url).then((text) => {
        const body = parseHandshakeBody(text);
        if (!body) return;
        handlers.onHandshake?.({
          sessionId: name.sessionId,
          kind: name.kind,
          fromUserId: message.author.id,
          sdp: body.sdp
        });
      }).catch((err) => console.warn("[P2PShare] handshake ileg\xEDvel", err));
    }
  });
  const unsubDelete = host.onMessageDelete((channelId, messageId) => {
    handlers.onBeaconGone?.(channelId, messageId);
  });
  return () => {
    unsubCreate();
    unsubDelete();
  };
}

// broadcast.ts
var session = null;
var listeners = /* @__PURE__ */ new Set();
function selfPreviewKey(sessionId) {
  return `self:${sessionId}`;
}
function currentState() {
  return { active: session !== null, viewers: session?.peers.viewerCount ?? 0 };
}
function notify() {
  const state = currentState();
  for (const listener of listeners) listener(state);
}
function onBroadcastStateChange(listener) {
  listeners.add(listener);
  listener(currentState());
  return () => listeners.delete(listener);
}
function isBroadcasting() {
  return session !== null;
}
function getBroadcastState() {
  return currentState();
}
async function startBroadcast() {
  if (session) {
    host.toast("Voc\xEA j\xE1 est\xE1 transmitindo", "info");
    return;
  }
  const channelId = host.getVoiceChannelId();
  if (!channelId) {
    host.toast("Entre num canal de voz primeiro", "error");
    return;
  }
  let stream;
  try {
    stream = await captureScreen({ pickSource: host.pickSource });
  } catch (err) {
    host.toast(
      err instanceof CaptureError ? err.message : `falha inesperada na captura: ${err.message}`,
      "error"
    );
    return;
  }
  const sessionId = newSessionId();
  const transport = {
    send: (kind, targetUserId, sdp) => sendHandshake(channelId, sessionId, kind, targetUserId, sdp)
  };
  const peers = new BroadcastPeers(stream, transport, {
    budgetMbps: host.getBudgetMbps()
  });
  peers.onCountChange = () => {
    host.setOverlayViewers(
      selfPreviewKey(sessionId),
      peers.viewerIds.map((id) => host.getUsername(id))
    );
    notify();
  };
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    void stopBroadcast();
  });
  const unsubscribe = observeSignals({
    onHandshake: (event) => {
      if (event.sessionId !== sessionId || event.kind !== "offer") return;
      peers.handleOffer(event.fromUserId, event.sdp).catch((err) => console.error("[P2PShare] falha ao responder offer", err));
    }
  });
  let beaconId;
  try {
    beaconId = await postBeacon(channelId, sessionId, host.getCurrentUsername());
  } catch (err) {
    unsubscribe();
    stream.getTracks().forEach((track) => track.stop());
    host.toast(`n\xE3o deu para anunciar a transmiss\xE3o: ${err.message}`, "error");
    return;
  }
  session = { sessionId, channelId, beaconId, stream, peers, unsubscribe };
  host.mountOverlay(
    selfPreviewKey(sessionId),
    stream,
    "Sua tela",
    () => host.unmountOverlay(selfPreviewKey(sessionId)),
    { muted: true, closeLabel: "Fechar a pr\xE9via (n\xE3o encerra a transmiss\xE3o)" }
  );
  notify();
  host.toast("Transmitindo via P2P", "success");
}
async function stopBroadcast() {
  const current = session;
  if (!current) return;
  session = null;
  host.unmountOverlay(selfPreviewKey(current.sessionId));
  current.unsubscribe();
  current.peers.closeAll();
  current.stream.getTracks().forEach((track) => track.stop());
  try {
    await removeBeacon(current.channelId, current.beaconId);
  } catch (err) {
    console.warn("[P2PShare] n\xE3o deu para apagar o beacon", err);
  }
  notify();
  host.toast("Transmiss\xE3o encerrada", "info");
}

// updater.ts
function parseMetaVersion(source) {
  const match = source.match(/@version\s+([^\s*]+)/);
  return match ? match[1] : null;
}
function parts(version) {
  if (!version) return null;
  const nums = version.split(".").map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}
function isNewer(remote, local) {
  const a = parts(remote);
  const b = parts(local);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
function looksLikePlugin(source, expectedName) {
  if (source.length < 1e3) return false;
  if (!source.includes("module.exports")) return false;
  const name = source.match(/@name\s+([^\s*]+)/);
  if (!name || name[1] !== expectedName) return false;
  return parseMetaVersion(source) !== null;
}

// watch.ts
var beacons = /* @__PURE__ */ new Map();
var watching = /* @__PURE__ */ new Map();
var beaconListeners = /* @__PURE__ */ new Set();
function notifyBeacons() {
  const list = [...beacons.values()];
  for (const listener of beaconListeners) listener(list);
}
function watchingCount() {
  return watching.size;
}
async function startWatching(beacon) {
  if (watching.has(beacon.sessionId)) return;
  const transport = {
    send: (kind, targetUserId, sdp) => sendHandshake(beacon.channelId, beacon.sessionId, kind, targetUserId, sdp)
  };
  const peer = new ViewerPeer(transport, beacon.broadcasterId);
  watching.set(beacon.sessionId, peer);
  peer.onStream = (stream) => {
    host.mountOverlay(
      beacon.sessionId,
      stream,
      beacon.broadcasterName,
      () => stopWatching(beacon.sessionId),
      { closeLabel: `Parar de assistir ${beacon.broadcasterName}` }
    );
  };
  peer.onFailed = (reason) => {
    host.toast(reason, "error");
    stopWatching(beacon.sessionId);
  };
  try {
    await peer.start();
    host.toast(`Conectando com ${beacon.broadcasterName}\u2026`, "info");
  } catch (err) {
    host.toast(`n\xE3o deu para pedir a transmiss\xE3o: ${err.message}`, "error");
    stopWatching(beacon.sessionId);
  }
}
function stopWatching(sessionId) {
  watching.get(sessionId)?.close();
  watching.delete(sessionId);
  host.unmountOverlay(sessionId);
  for (const beacon of beacons.values()) {
    if (beacon.sessionId !== sessionId) continue;
    host.announceBeacon(
      { sessionId: beacon.sessionId, broadcasterName: beacon.broadcasterName },
      () => {
        void startWatching(beacon);
      }
    );
    return;
  }
}
function initWatcher() {
  const myId = host.getCurrentUserId();
  const unsubscribe = observeSignals({
    onBeacon: (beacon) => {
      if (beacon.broadcasterId === myId) return;
      beacons.set(beacon.messageId, beacon);
      notifyBeacons();
      host.announceBeacon(
        { sessionId: beacon.sessionId, broadcasterName: beacon.broadcasterName },
        () => {
          void startWatching(beacon);
        }
      );
    },
    onBeaconGone: (_channelId, messageId) => {
      const beacon = beacons.get(messageId);
      if (!beacon) return;
      beacons.delete(messageId);
      host.revokeBeacon(beacon.sessionId);
      stopWatching(beacon.sessionId);
      notifyBeacons();
    },
    onHandshake: (event) => {
      if (event.kind !== "answer") return;
      watching.get(event.sessionId)?.handleAnswer(event.sdp).catch((err) => console.error("[P2PShare] answer inv\xE1lida", err));
    }
  });
  return () => {
    unsubscribe();
    for (const beacon of beacons.values()) host.revokeBeacon(beacon.sessionId);
    beacons.clear();
    for (const sessionId of [...watching.keys()]) stopWatching(sessionId);
    host.unmountAllOverlays();
    notifyBeacons();
  };
}

// host/bd/updater.ts
var PLUGIN_NAME = "P2PShare";
var FILE_NAME = "P2PShare.plugin.js";
var RETRY_WHEN_BUSY_MS = 5 * 60 * 1e3;
var CHECK_INTERVAL_MS = 6 * 60 * 60 * 1e3;
function isBusy() {
  return isBroadcasting() || watchingCount() > 0;
}
async function fetchLatest() {
  try {
    const res = await fetch(UPDATE_URL, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[P2PShare] updater: host respondeu ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn("[P2PShare] updater: n\xE3o deu para checar atualiza\xE7\xE3o", err);
    return null;
  }
}
function install(source, version) {
  try {
    const fs = require("fs");
    const path = require("path");
    const target = path.join(BdApi.Plugins.folder, FILE_NAME);
    fs.writeFileSync(target, source, "utf8");
    BdApi.UI.showToast(
      `P2PShare atualizado para ${version}.`,
      { type: "success" }
    );
    return true;
  } catch (err) {
    BdApi.UI.showToast(
      `N\xE3o deu para gravar a atualiza\xE7\xE3o: ${err.message}`,
      { type: "error" }
    );
    return false;
  }
}
function offer(source, version) {
  const close = BdApi.UI.showNotice(
    `P2PShare ${version} dispon\xEDvel (voc\xEA tem ${PLUGIN_VERSION}).`,
    {
      type: "info",
      buttons: [{
        label: "Atualizar",
        onClick: () => {
          if (isBusy()) {
            BdApi.UI.showToast(
              "Termine a transmiss\xE3o antes de atualizar \u2014 o plugin recarrega e a sess\xE3o cairia.",
              { type: "warning" }
            );
            return;
          }
          if (install(source, version)) {
            try {
              close();
            } catch {
            }
          }
        }
      }]
    }
  );
}
async function checkForUpdate() {
  if (!UPDATE_URL) return;
  if (isBusy()) {
    setTimeout(() => {
      void checkForUpdate();
    }, RETRY_WHEN_BUSY_MS);
    return;
  }
  const source = await fetchLatest();
  if (!source) return;
  if (!looksLikePlugin(source, PLUGIN_NAME)) {
    console.warn("[P2PShare] updater: resposta n\xE3o parece o plugin, ignorando");
    return;
  }
  const remote = parseMetaVersion(source);
  if (!remote || !isNewer(remote, PLUGIN_VERSION)) return;
  if (isBusy()) {
    setTimeout(() => {
      void checkForUpdate();
    }, RETRY_WHEN_BUSY_MS);
    return;
  }
  if (loadSetting("autoUpdate", true)) install(source, remote);
  else offer(source, remote);
}
function startUpdateChecks() {
  void checkForUpdate();
  const timer = setInterval(() => {
    void checkForUpdate();
  }, CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}

// bd-entry.ts
var P2PShare = class {
  cleanupWatcher = null;
  cleanupState = null;
  cleanupUpdater = null;
  cleanupVoiceBtn = null;
  start() {
    ui_exports.injectStyles();
    const toggle = () => {
      if (getBroadcastState().active) void stopBroadcast();
      else void startBroadcast();
    };
    this.cleanupWatcher = initWatcher();
    ui_exports.mountLauncher({
      position: {
        x: loadSetting("launcherX", window.innerWidth - 80),
        y: loadSetting("launcherY", window.innerHeight - 160)
      },
      onToggle: toggle,
      onMoved: (pos) => {
        saveSetting("launcherX", pos.x);
        saveSetting("launcherY", pos.y);
      }
    });
    this.cleanupVoiceBtn = ui_exports.mountVoiceButton({
      onToggle: toggle,
      onAnchorChange: (found) => ui_exports.setLauncherHidden(found)
    });
    this.cleanupState = onBroadcastStateChange((state) => {
      ui_exports.updateLauncher(state);
      ui_exports.updateVoiceButton(state);
    });
    this.cleanupUpdater = startUpdateChecks();
  }
  stop() {
    void stopBroadcast();
    this.cleanupState?.();
    this.cleanupState = null;
    this.cleanupVoiceBtn?.();
    this.cleanupVoiceBtn = null;
    this.cleanupUpdater?.();
    this.cleanupUpdater = null;
    this.cleanupWatcher?.();
    this.cleanupWatcher = null;
    ui_exports.unmountLauncher();
    ui_exports.unmountAllOverlays();
    ui_exports.removeStyles();
  }
  getSettingsPanel() {
    const wrap = document.createElement("div");
    wrap.style.color = "var(--header-primary, #fff)";
    const label = document.createElement("div");
    const current = loadSetting("uploadBudgetMbps", DEFAULT_BUDGET_MBPS);
    label.textContent = `Or\xE7amento de upload: ${current} Mbps`;
    label.style.marginBottom = "8px";
    const hint = document.createElement("div");
    hint.textContent = "Dividido entre os viewers conectados. 15 Mbps d\xE1 1080p60 para 2 pessoas ou 720p30 para 6.";
    hint.style.cssText = "font-size:12px;color:var(--text-muted,#72767d);margin-bottom:12px";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "2";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(current);
    slider.style.width = "100%";
    slider.addEventListener("input", () => {
      label.textContent = `Or\xE7amento de upload: ${slider.value} Mbps`;
      saveSetting("uploadBudgetMbps", Number(slider.value));
    });
    const auto = document.createElement("label");
    auto.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:20px;cursor:pointer";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = loadSetting("autoUpdate", true);
    check.addEventListener("change", () => saveSetting("autoUpdate", check.checked));
    const autoText = document.createElement("span");
    autoText.textContent = "Atualizar sozinho quando sair vers\xE3o nova";
    auto.append(check, autoText);
    const autoHint = document.createElement("div");
    autoHint.textContent = "Desligado, o plugin apenas avisa e espera voc\xEA clicar. Nunca atualiza durante uma transmiss\xE3o.";
    autoHint.style.cssText = "font-size:12px;color:var(--text-muted,#72767d);margin-top:4px";
    wrap.append(label, hint, slider, auto, autoHint);
    return wrap;
  }
};
module.exports = module.exports.default;
