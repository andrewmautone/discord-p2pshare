/**
 * @name P2PShare
 * @author Andrew
 * @description Compartilhamento de tela ponto-a-ponto via WebRTC, sem passar pela infra de video do Discord e sem servidor proprio.
 * @version 1.14.0
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
  // Sem seletor injetado, transmite a primeira fonte, sem áudio: mandar o
  // áudio do sistema devolveria a própria chamada para quem assiste.
  pickSource: async (sources) => sources[0] ? { id: sources[0].id, audio: false } : null,
  combine: (tracks) => new MediaStream(tracks)
};
async function captureScreen(deps = {}, opts = {}) {
  const d = { ...defaultDeps, ...deps };
  const wantAudio = opts.audio !== false;
  let sources = [];
  try {
    sources = await d.getSources();
  } catch (err) {
    console.warn("[P2PShare] DiscordNative indispon\xEDvel, tentando getDisplayMedia", err);
  }
  if (sources.length) {
    const choice = await d.pickSource(sources);
    if (!choice) throw new CaptureError("captura cancelada pelo usu\xE1rio");
    const sourceId = choice.id;
    const withAudio = wantAudio && choice.audio;
    const video = {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxFrameRate: 60
      }
    };
    const isolated = withAudio && opts.audioForSource ? await opts.audioForSource(sourceId) : null;
    if (isolated) {
      const videoOnly = await d.getUserMedia({ audio: false, video }).catch((err) => {
        throw new CaptureError(`falha ao capturar a fonte: ${err.message}`);
      });
      return d.combine([...videoOnly.getTracks(), isolated]);
    }
    if (withAudio && opts.audioDeviceId) {
      const videoOnly = await d.getUserMedia({ audio: false, video }).catch((err) => {
        throw new CaptureError(`falha ao capturar a fonte: ${err.message}`);
      });
      try {
        const mic = await d.getUserMedia({
          audio: { deviceId: { exact: opts.audioDeviceId } },
          video: false
        });
        return d.combine([...videoOnly.getTracks(), ...mic.getTracks()]);
      } catch (err) {
        console.warn("[P2PShare] dispositivo de \xE1udio indispon\xEDvel", err);
        return videoOnly;
      }
    }
    if (withAudio) {
      try {
        return await d.getUserMedia({
          audio: { mandatory: { chromeMediaSource: "desktop" } },
          video
        });
      } catch (err) {
        console.warn("[P2PShare] sem \xE1udio do sistema, transmitindo s\xF3 v\xEDdeo", err);
      }
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
      audio: wantAudio
    });
  } catch (err) {
    throw new CaptureError(
      `nenhuma API de captura de tela dispon\xEDvel: ${err.message}`
    );
  }
}

// constants.ts
var PROTOCOL_VERSION = 1;
var PLUGIN_VERSION = "1.14.0";
var DOWNLOAD_URL = "https://github.com/andrewmautone/discord-p2pshare/releases/latest/download/P2PShare-Setup.exe";
var HELPER_URL = `https://github.com/andrewmautone/discord-p2pshare/releases/download/v${PLUGIN_VERSION}/p2pshare-audio.exe`;
var HELPER_SHA256 = "3b71f2742c6e92b0dd9621a332a55ce0dc51b19ded802c9bfa548de9e476b3cf";
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
function onVoiceChannelChange(handler) {
  const listener = (event) => {
    try {
      handler(event.channelId ?? null);
    } catch (err) {
      console.error("[P2PShare] handler de VOICE_CHANNEL_SELECT falhou", err);
    }
  };
  FluxDispatcher().subscribe("VOICE_CHANNEL_SELECT", listener);
  return () => FluxDispatcher().unsubscribe("VOICE_CHANNEL_SELECT", listener);
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

// host/bd/audioHelper.ts
function attemptMarkerPath() {
  return require("path").join(BdApi.Plugins.folder, ".p2pshare-audio-attempt");
}
var nativeBlocked = false;
function nativeAudioBlocked() {
  return nativeBlocked;
}
function unblockNativeAudio() {
  nativeBlocked = false;
  try {
    const fs = require("fs");
    if (fs.existsSync(attemptMarkerPath())) fs.unlinkSync(attemptMarkerPath());
  } catch {
  }
}
function checkPreviousCrash() {
  try {
    const fs = require("fs");
    if (!fs.existsSync(attemptMarkerPath())) return;
    fs.unlinkSync(attemptMarkerPath());
    nativeBlocked = true;
    lastError = "a tentativa anterior derrubou o Discord; o \xE1udio isolado ficou desligado por seguran\xE7a";
    console.warn("[P2PShare] " + lastError);
  } catch {
  }
}
function spawnHelper(exe, args) {
  if (nativeBlocked) {
    throw new Error("caminho nativo desligado depois de uma queda anterior");
  }
  const wrap = process.binding;
  if (typeof wrap !== "function") {
    throw new Error("este cliente n\xE3o exp\xF5e as liga\xE7\xF5es necess\xE1rias");
  }
  const { Process } = wrap("process_wrap");
  const pipeWrap = wrap("pipe_wrap");
  if (typeof Process !== "function" || typeof pipeWrap?.Pipe !== "function") {
    throw new Error("as liga\xE7\xF5es de processo n\xE3o t\xEAm o formato esperado");
  }
  const fs = require("fs");
  fs.writeFileSync(attemptMarkerPath(), (/* @__PURE__ */ new Date()).toISOString(), "utf8");
  const clearMarker = () => {
    try {
      if (fs.existsSync(attemptMarkerPath())) fs.unlinkSync(attemptMarkerPath());
    } catch {
    }
  };
  const stdout = new pipeWrap.Pipe(pipeWrap.constants.SOCKET);
  const child = new Process();
  let onData = () => {
  };
  let onExit = () => {
  };
  let alive = true;
  stdout.onread = (first, second) => {
    const data = typeof first === "number" ? second : first;
    if (data && data.byteLength) onData(new Uint8Array(data));
  };
  child.onexit = () => {
    alive = false;
    onExit();
  };
  const code = child.spawn({
    file: exe,
    // argv[0] é o próprio programa, como todo processo espera.
    args: [exe, ...args],
    // Caminho real, nunca undefined: a checagem nativa do Node 24 é
    // mais estrita e aborta o processo em vez de reclamar.
    cwd: BdApi.Plugins.folder,
    windowsHide: true,
    windowsVerbatimArguments: false,
    detached: false,
    envPairs: Object.entries(process.env).map(([k, v]) => `${k}=${v}`),
    stdio: [
      { type: "ignore" },
      { type: "pipe", handle: stdout, readable: false, writable: true },
      { type: "ignore" }
    ]
  });
  if (code !== 0) {
    clearMarker();
    throw new Error(`n\xE3o deu para iniciar o componente (c\xF3digo ${code})`);
  }
  stdout.readStart();
  setTimeout(clearMarker, 1500);
  return {
    onData: (handler) => {
      onData = handler;
    },
    onExit: (handler) => {
      onExit = handler;
    },
    kill: () => {
      if (!alive) return;
      alive = false;
      try {
        child.kill();
      } catch {
      }
      try {
        stdout.close();
      } catch {
      }
    }
  };
}
var HELPER_NAME = "p2pshare-audio.exe";
var SAMPLE_RATE = 48e3;
var CHANNELS = 2;
var RING_FRAMES = SAMPLE_RATE;
function helperPath() {
  const path = require("path");
  return path.join(BdApi.Plugins.folder, HELPER_NAME);
}
async function downloadBuffer(url) {
  const net = BdApi.Net?.fetch;
  const res = net ? await net(url, { redirect: "follow" }) : await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`o servidor respondeu ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
function sha256(data) {
  return require("crypto").createHash("sha256").update(data).digest("hex");
}
function localHelperIsValid() {
  try {
    const fs = require("fs");
    const file = helperPath();
    if (!fs.existsSync(file)) return false;
    return sha256(fs.readFileSync(file)) === HELPER_SHA256;
  } catch {
    return false;
  }
}
function helperReady() {
  const valid = localHelperIsValid();
  if (valid && lastError) {
    lastError = null;
    clearDiagnostics();
  }
  return valid;
}
function clearDiagnostics() {
  try {
    const fs = require("fs");
    const path = require("path");
    const file = path.join(BdApi.Plugins.folder, "p2pshare-audio-debug.json");
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
  }
}
var downloading = null;
function ensureHelper() {
  if (localHelperIsValid()) return Promise.resolve(helperPath());
  downloading ??= download().finally(() => {
    downloading = null;
  });
  return downloading;
}
async function download() {
  try {
    const buffer = await downloadBuffer(HELPER_URL);
    const digest = sha256(buffer);
    if (digest !== HELPER_SHA256) {
      throw new Error(
        `assinatura n\xE3o confere (esperado ${HELPER_SHA256.slice(0, 12)}, veio ${digest.slice(0, 12)})`
      );
    }
    require("fs").writeFileSync(helperPath(), buffer);
    lastError = null;
    return helperPath();
  } catch (err) {
    lastError = err.message;
    console.warn("[P2PShare] n\xE3o deu para baixar o componente de \xE1udio", err);
    recordDiagnostics();
    return null;
  }
}
var lastError = null;
function helperError() {
  return lastError;
}
function recordDiagnostics() {
  try {
    const fs = require("fs");
    const path = require("path");
    fs.writeFileSync(
      path.join(BdApi.Plugins.folder, "p2pshare-audio-debug.json"),
      JSON.stringify({
        quando: (/* @__PURE__ */ new Date()).toISOString(),
        url: HELPER_URL,
        hashEsperado: HELPER_SHA256,
        pastaDePlugins: BdApi.Plugins.folder,
        arquivoExiste: helperFileExists(),
        erro: lastError
      }, null, 2),
      "utf8"
    );
  } catch (err) {
    console.warn("[P2PShare] n\xE3o deu para gravar o diagn\xF3stico de \xE1udio", err);
  }
}
function removeHelper() {
  try {
    const fs = require("fs");
    if (fs.existsSync(helperPath())) fs.unlinkSync(helperPath());
    lastError = null;
    return true;
  } catch (err) {
    lastError = err.message;
    console.warn("[P2PShare] n\xE3o deu para remover o componente", err);
    return false;
  }
}
async function syncHelper() {
  if (localHelperIsValid()) return;
  const hadOldVersion = helperFileExists();
  const path = await ensureHelper();
  if (path && hadOldVersion) {
    console.info("[P2PShare] componente de \xE1udio atualizado");
  }
}
function helperFileExists() {
  try {
    return require("fs").existsSync(helperPath());
  } catch {
    return false;
  }
}
function discordTreePid() {
  return process.ppid || process.pid;
}
function helperArgs(sourceId) {
  const [kind, handle] = sourceId.split(":");
  if (kind === "window" && handle) {
    return ["--include-window", handle];
  }
  return ["--exclude", String(discordTreePid())];
}
async function captureIsolatedAudio(sourceId) {
  const exe = await ensureHelper();
  if (!exe) {
    console.info("[P2PShare] componente de \xE1udio ausente, usando o \xE1udio do sistema");
    return null;
  }
  try {
    const child = spawnHelper(exe, helperArgs(sourceId));
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const destination = context.createMediaStreamDestination();
    const ring = new Float32Array(RING_FRAMES * CHANNELS);
    let writeAt = 0;
    let readAt = 0;
    let available = 0;
    let leftover = new Uint8Array(0);
    child.onData((chunk) => {
      let buf = chunk;
      if (leftover.length) {
        buf = new Uint8Array(leftover.length + chunk.length);
        buf.set(leftover);
        buf.set(chunk, leftover.length);
      }
      const usable = buf.length - buf.length % 4;
      leftover = buf.slice(usable);
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      for (let i = 0; i < usable; i += 4) {
        ring[writeAt] = view.getFloat32(i, true);
        writeAt = (writeAt + 1) % ring.length;
        if (available < ring.length) available++;
        else readAt = (readAt + 1) % ring.length;
      }
    });
    const node = context.createScriptProcessor(1024, 0, CHANNELS);
    node.onaudioprocess = (event) => {
      const left = event.outputBuffer.getChannelData(0);
      const right = event.outputBuffer.getChannelData(1);
      for (let i = 0; i < left.length; i++) {
        if (available >= CHANNELS) {
          left[i] = ring[readAt];
          right[i] = ring[(readAt + 1) % ring.length];
          readAt = (readAt + CHANNELS) % ring.length;
          available -= CHANNELS;
        } else {
          left[i] = 0;
          right[i] = 0;
        }
      }
    };
    node.connect(destination);
    const track = destination.stream.getAudioTracks()[0];
    if (!track) throw new Error("o contexto de \xE1udio n\xE3o produziu trilha");
    const stop = () => {
      child.kill();
      node.disconnect();
      void context.close();
    };
    child.onExit(() => {
      node.onaudioprocess = null;
    });
    return { track, stop };
  } catch (err) {
    lastError = err.message;
    recordDiagnostics();
    console.error("[P2PShare] n\xE3o deu para capturar \xE1udio isolado", err);
    BdApi.UI.showToast(
      `\xC1udio isolado indispon\xEDvel: ${err.message}`,
      { type: "error" }
    );
    return null;
  }
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
  closeBroadcastMenu: () => closeBroadcastMenu,
  dumpVoiceDiagnostics: () => dumpVoiceDiagnostics,
  focusChannel: () => focusChannel,
  injectStyles: () => injectStyles,
  mountLauncher: () => mountLauncher,
  mountOverlay: () => mountOverlay,
  mountVoiceButton: () => mountVoiceButton,
  openBroadcastMenu: () => openBroadcastMenu,
  openSourcePicker: () => openSourcePicker,
  removeStyles: () => removeStyles,
  revokeBeacon: () => revokeBeacon,
  setLauncherHidden: () => setLauncherHidden,
  setLiveUsers: () => setLiveUsers,
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
/* As classes do Discord nao dimensionam o icone: o SVG deles carrega
   width/height proprios. Sem isto o botao existe com 0 pixel. */
.p2ps-voice-btn svg { width: 20px; height: 20px; }
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
.p2ps-menu {
    position: fixed;
    z-index: 4200;
    min-width: 220px;
    padding: 6px;
    border-radius: 8px;
    background: var(--background-floating, #18191c);
    box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
    color: var(--header-primary, #fff);
    font-size: 14px;
}
.p2ps-menu-item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 9px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
}
.p2ps-menu-item:hover { background: var(--brand-experiment, #5865f2); }
.p2ps-menu-value { color: var(--text-muted, #b5bac1); font-size: 13px; }
.p2ps-menu-item:hover .p2ps-menu-value { color: #fff; }
.p2ps-menu-check { width: 12px; text-align: right; }
.p2ps-menu-sep {
    height: 1px;
    margin: 5px 4px;
    background: var(--background-modifier-accent, #3f4147);
}
.p2ps-menu-danger { color: var(--status-danger, #ed4245); }
.p2ps-menu-danger:hover { background: var(--status-danger, #ed4245); color: #fff; }
.p2ps-submenu {
    display: none;
    position: absolute;
    left: 100%;
    top: -6px;
    margin-left: 4px;
    min-width: 150px;
    padding: 6px;
    border-radius: 8px;
    background: var(--background-floating, #18191c);
    box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
}
.p2ps-menu-parent:hover > .p2ps-submenu { display: block; }

.p2ps-clickable { cursor: pointer; }
.p2ps-clickable:hover { filter: brightness(1.15); }
.p2ps-tile-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
    z-index: 1;
    border-radius: inherit;
}
.p2ps-tile-bar {
    position: absolute;
    right: 8px;
    bottom: 8px;
    z-index: 3;
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 6px;
    background: rgb(0 0 0 / 65%);
    opacity: 0;
    transition: opacity .15s;
}
[class*="tileChild"]:hover .p2ps-tile-bar { opacity: 1; }
.p2ps-tile-bar button {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 2px 4px;
}
.p2ps-tile-bar button:hover { color: var(--brand-experiment, #5865f2); }
.p2ps-tile-vol { width: 60px; accent-color: var(--brand-experiment, #5865f2); }
@media (prefers-reduced-motion: reduce) {
    .p2ps-tile-bar { transition: none; }
}
.p2ps-audio-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--header-primary, #fff);
    font-size: 13px;
    cursor: pointer;
}
.p2ps-audio-toggle input:disabled + span { color: var(--text-muted, #72767d); }
.p2ps-audio-toggle input { accent-color: var(--brand-experiment, #5865f2); }
.p2ps-foot-space { flex: 1; }
.p2ps-tile-cta {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: none;
    border-radius: 8px;
    padding: 10px 18px;
    background: var(--status-danger, #ed4245);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 14px rgb(0 0 0 / 45%);
    transition: transform .12s, filter .12s;
    white-space: nowrap;
}
.p2ps-tile-cta:hover { filter: brightness(1.12); transform: translate(-50%, -50%) scale(1.04); }
.p2ps-cta-play { font-size: 12px; }
@media (prefers-reduced-motion: reduce) {
    .p2ps-tile-cta { transition: none; }
    .p2ps-tile-cta:hover { transform: translate(-50%, -50%); }
}
.p2ps-tile-live {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 2;
    /* O overlay do Discord desliga eventos; o selo precisa reativar. */
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    background: var(--status-danger, #ed4245);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .04em;
    cursor: pointer;
    box-shadow: 0 2px 6px rgb(0 0 0 / 35%);
}
.p2ps-tile-live:hover:not(:disabled) { filter: brightness(1.15); }
.p2ps-tile-live:disabled { cursor: default; opacity: .9; }
.p2ps-live-chip {
    display: inline-flex;
    /* A linha do participante \xE9 um bot\xE3o inteiro; sem isto o clique no selo
       vira clique na pessoa. */
    pointer-events: auto;
    flex-shrink: 0;
    margin-left: auto;
    align-items: center;
    align-self: center;
    flex: 0 0 auto;
    vertical-align: middle;
    margin-left: 6px;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--status-danger, #ed4245);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .06em;
    line-height: 14px;
    white-space: nowrap;
}
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
  closeBroadcastMenu();
  BdApi.DOM.removeStyle("P2PShare");
}
function makeDraggable(el, handle, onDrop) {
  let offset = null;
  handle.addEventListener("mousedown", (e) => {
    if (e.target?.closest("button, input, select, a")) return;
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
    if (!moved) opts.onToggle(el);
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
var voiceBtns = /* @__PURE__ */ new Map();
var voiceObserver = null;
var lastState = { active: false, viewers: 0 };
function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
var isOurs = (el) => !!el?.classList.contains("p2ps-voice-btn");
function climbToPeer(el) {
  let node = el;
  while (node.parentElement && node.parentElement !== document.body && node.parentElement.childElementCount === 1) {
    node = node.parentElement;
  }
  return node;
}
function collectSites() {
  const sites = [];
  const anchors = /* @__PURE__ */ new Set();
  for (const path of document.querySelectorAll('button svg path[d^="M2 4.5C2 3.397"]')) {
    const btn = path.closest("button");
    if (btn && !isOurs(btn)) anchors.add(btn);
  }
  for (const btn of document.querySelectorAll("button[aria-label]")) {
    if (isOurs(btn)) continue;
    const label = (btn.getAttribute("aria-label") || "").toLowerCase();
    if (!/compartilh|share/.test(label)) continue;
    if (/cheia|fullscreen|convite|invite|link/.test(label)) continue;
    anchors.add(btn);
  }
  for (const anchor of anchors) {
    if (anchor.closest('[class*="actionButtons"]')) continue;
    const peer = climbToPeer(anchor);
    sites.push({
      host: anchor,
      style: anchor,
      container: peer.parentElement ?? peer,
      place: (btn) => {
        const wrapper = document.createElement("div");
        wrapper.className = peer.className;
        wrapper.appendChild(btn);
        btn.__p2psWrapper = wrapper;
        peer.insertAdjacentElement("afterend", wrapper);
      }
    });
  }
  for (const row of document.querySelectorAll('[class*="actionButtons"]')) {
    const sibling = [...row.querySelectorAll("button")].find((b) => !isOurs(b));
    if (!sibling) continue;
    sites.push({
      host: row,
      style: sibling,
      container: row,
      place: (btn) => row.appendChild(btn)
    });
  }
  return sites;
}
function paintOne(btn) {
  const svg = btn.querySelector("svg");
  if (svg) svg.style.color = lastState.active ? "var(--status-danger, #ed4245)" : "";
  const label = lastState.active ? `Parar transmiss\xE3o P2P \u2014 ${lastState.viewers} assistindo` : "Transmitir tela via P2P";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.querySelector(".p2ps-voice-count")?.remove();
  if (lastState.active && lastState.viewers > 0) {
    const badge = document.createElement("span");
    badge.className = "p2ps-voice-count";
    badge.textContent = String(lastState.viewers);
    btn.appendChild(badge);
  }
}
function removeBtn(btn) {
  const wrapper = btn.__p2psWrapper;
  (wrapper ?? btn).remove();
}
function mountVoiceButton(opts) {
  const sync = () => {
    for (const [host2, btn] of voiceBtns) {
      if (!host2.isConnected || !btn.isConnected) {
        removeBtn(btn);
        voiceBtns.delete(host2);
      }
    }
    for (const btn of document.querySelectorAll(".p2ps-voice-btn")) {
      const parent = btn.parentElement;
      if (!parent) continue;
      const ours = parent.querySelectorAll(".p2ps-voice-btn");
      for (let i = 1; i < ours.length; i++) ours[i].remove();
    }
    for (const site of collectSites()) {
      if (voiceBtns.has(site.host)) continue;
      if (site.container.querySelector(".p2ps-voice-btn")) continue;
      const btn = document.createElement("button");
      btn.className = `${site.style.className} p2ps-voice-btn`;
      btn.type = "button";
      btn.innerHTML = SCREENSHARE_SVG;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        opts.onToggle(btn);
      });
      site.place(btn);
      paintOne(btn);
      voiceBtns.set(site.host, btn);
    }
    opts.onAnchorChange([...voiceBtns.values()].some(isVisible));
    applyLiveBadges();
    applyTileBadges();
    applyTileVideos();
    dumpVoiceDiagnostics();
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
    for (const btn of voiceBtns.values()) removeBtn(btn);
    voiceBtns.clear();
  };
}
var lastDumpKey = "";
function dumpVoiceDiagnostics() {
  try {
    const sites = collectSites();
    const key = sites.map((s) => s.host.className).join("|") + "#" + voiceBtns.size;
    if (key === lastDumpKey) return;
    lastDumpKey = key;
    const data = {
      quando: (/* @__PURE__ */ new Date()).toISOString(),
      pontosEncontrados: sites.length,
      injetados: [...voiceBtns.values()].map((b) => {
        const r = b.getBoundingClientRect();
        return {
          visivel: isVisible(b),
          tamanho: `${Math.round(r.width)}x${Math.round(r.height)}`,
          pos: `${Math.round(r.x)},${Math.round(r.y)}`
        };
      }),
      flutuante: launcher ? launcher.classList.contains("p2ps-launcher-hidden") ? "escondido" : "visivel" : "nao montado"
    };
    const fs = require("fs");
    const path = require("path");
    fs.writeFileSync(
      path.join(BdApi.Plugins.folder, "p2pshare-debug.json"),
      JSON.stringify(data, null, 2),
      "utf8"
    );
  } catch (err) {
    console.warn("[P2PShare] n\xE3o deu para gravar o diagn\xF3stico", err);
  }
}
function updateVoiceButton(state) {
  lastState = state;
  for (const btn of voiceBtns.values()) paintOne(btn);
}
var liveUsers = [];
function applyLiveBadges() {
  for (const row of document.querySelectorAll('[class*="voiceUser"]')) {
    const nameEl = row.querySelector('[class*="username__"]');
    const text = nameEl?.textContent?.trim();
    const avatar = row.querySelector('[class*="userAvatar"]');
    const id = (avatar?.style.backgroundImage || "").match(/avatars\/(\d+)\//)?.[1];
    const live = liveUsers.some((u) => id && u.id === id || !!text && u.names.includes(text));
    const existing = row.querySelector(".p2ps-live-chip");
    if (!live) {
      existing?.remove();
      continue;
    }
    if (existing) continue;
    const user = liveUsers.find((u) => id && u.id === id || !!text && u.names.includes(text));
    const chip = document.createElement("span");
    chip.className = "p2ps-live-chip";
    chip.textContent = "AO VIVO";
    if (user?.onWatch) {
      chip.classList.add("p2ps-clickable");
      chip.title = "Clique para assistir";
      chip.setAttribute("role", "button");
      chip.tabIndex = 0;
      const open = (e) => {
        e.preventDefault();
        e.stopPropagation();
        user.onWatch();
      };
      chip.addEventListener("mousedown", (e) => e.stopPropagation());
      chip.addEventListener("click", open);
    } else {
      chip.title = "Transmitindo via P2PShare";
    }
    const slot = row.querySelector('[class*="content__"]') ?? row.querySelector('[class*="chipletParent"]') ?? nameEl?.parentElement;
    slot?.appendChild(chip);
  }
}
function currentUserId() {
  try {
    return BdApi.Webpack.getModule((m) => m?.getCurrentUser && m?.getUser)?.getCurrentUser()?.id ?? null;
  } catch {
    return null;
  }
}
function applyTileBadges() {
  for (const tile of document.querySelectorAll("[data-selenium-video-tile]")) {
    const id = tile.getAttribute("data-selenium-video-tile");
    const user = liveUsers.find((u) => u.id === id);
    const existing = tile.querySelector(".p2ps-tile-live");
    if (!user) {
      existing?.remove();
      tile.querySelector(".p2ps-tile-cta")?.remove();
      continue;
    }
    if (!user.onWatch || tile.querySelector(".p2ps-tile-video")) {
      tile.querySelector(".p2ps-tile-cta")?.remove();
    }
    if (existing) continue;
    const badge = document.createElement("span");
    badge.className = "p2ps-tile-live";
    badge.textContent = "AO VIVO";
    badge.title = user.onWatch ? "Transmitindo via P2PShare" : "Voc\xEA est\xE1 transmitindo via P2PShare";
    const slot = tile.querySelector('[class*="overlayTop"]') ?? tile.querySelector('[class*="tileChild"]') ?? tile;
    slot.appendChild(badge);
    if (!user.onWatch) continue;
    if (id === currentUserId()) continue;
    const child = tile.querySelector('[class*="tileChild"]') ?? tile;
    if (child.querySelector(".p2ps-tile-cta")) continue;
    if (child.querySelector(".p2ps-tile-video")) continue;
    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "p2ps-tile-cta";
    cta.innerHTML = '<span class="p2ps-cta-play">\u25B6</span> Assistir transmiss\xE3o';
    cta.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      user.onWatch();
    });
    child.appendChild(cta);
  }
}
function focusChannel(channelId) {
  const safe = channelId.replace(/[^\w-]/g, "");
  if (!safe) return;
  const link = document.querySelector(
    `[data-list-item-id="channels___${safe}"]`
  );
  link?.click();
}
function setLiveUsers(users) {
  liveUsers = users;
  applyLiveBadges();
  applyTileBadges();
}
var RESOLUTIONS = [
  { label: "Original", value: null },
  { label: "1440p", value: 1440 },
  { label: "1080p", value: 1080 },
  { label: "720p", value: 720 },
  { label: "480p", value: 480 }
];
var FRAMERATES = [
  { label: "M\xE1ximo", value: null },
  { label: "60 fps", value: 60 },
  { label: "30 fps", value: 30 },
  { label: "15 fps", value: 15 }
];
var openMenu = null;
function closeBroadcastMenu() {
  openMenu?.remove();
  openMenu = null;
}
function openBroadcastMenu(anchor, opts) {
  closeBroadcastMenu();
  const menu = document.createElement("div");
  menu.className = "p2ps-menu";
  const current = { ...opts.quality };
  const addSubmenu = (title, options, selected, apply) => {
    const item = document.createElement("div");
    item.className = "p2ps-menu-item p2ps-menu-parent";
    const label = document.createElement("span");
    label.textContent = title;
    const value = document.createElement("span");
    value.className = "p2ps-menu-value";
    const paintValue = () => {
      value.textContent = (options.find((o) => o.value === selected())?.label ?? "\u2014") + "  \u203A";
    };
    paintValue();
    item.append(label, value);
    const sub = document.createElement("div");
    sub.className = "p2ps-submenu";
    for (const option of options) {
      const row = document.createElement("div");
      row.className = "p2ps-menu-item";
      row.textContent = option.label;
      const check = document.createElement("span");
      check.className = "p2ps-menu-check";
      check.textContent = option.value === selected() ? "\u2713" : "";
      row.appendChild(check);
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        apply(option.value);
        paintValue();
        for (const other of sub.querySelectorAll(".p2ps-menu-check")) {
          other.textContent = "";
        }
        check.textContent = "\u2713";
        opts.onQuality(current);
      });
      sub.appendChild(row);
    }
    item.appendChild(sub);
    menu.appendChild(item);
  };
  addSubmenu(
    "Resolu\xE7\xE3o",
    RESOLUTIONS,
    () => current.maxHeight,
    (v) => {
      current.maxHeight = v;
    }
  );
  addSubmenu(
    "Taxa de quadros",
    FRAMERATES,
    () => current.maxFramerate,
    (v) => {
      current.maxFramerate = v;
    }
  );
  const sep = document.createElement("div");
  sep.className = "p2ps-menu-sep";
  menu.appendChild(sep);
  const stop = document.createElement("div");
  stop.className = "p2ps-menu-item p2ps-menu-danger";
  stop.textContent = "Parar de transmitir";
  stop.addEventListener("click", (e) => {
    e.stopPropagation();
    closeBroadcastMenu();
    opts.onStop();
  });
  menu.appendChild(stop);
  document.body.appendChild(menu);
  openMenu = menu;
  const rect = anchor.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - box.width / 2),
    window.innerWidth - box.width - 8
  );
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, rect.top - box.height - 8)}px`;
  const onOutside = (e) => {
    if (!menu.contains(e.target)) {
      closeBroadcastMenu();
      cleanup();
    }
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      closeBroadcastMenu();
      cleanup();
    }
  };
  const cleanup = () => {
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
  };
  setTimeout(() => {
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
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
                    <label class="p2ps-audio-toggle">
                        <input type="checkbox" data-act="audio">
                        <span data-act="audio-label"></span>
                    </label>
                    <span class="p2ps-foot-space"></span>
                    <button class="p2ps-btn p2ps-btn-secondary" data-act="cancel">Cancelar</button>
                    <button class="p2ps-btn" data-act="ok" disabled>Transmitir</button>
                </div>
            </div>`;
    const grid = backdrop.querySelector(".p2ps-grid");
    const okBtn = backdrop.querySelector('[data-act="ok"]');
    const audioCheck = backdrop.querySelector('[data-act="audio"]');
    const audioLabel = backdrop.querySelector('[data-act="audio-label"]');
    const audioAvailable = helperReady() && !nativeAudioBlocked();
    audioCheck.disabled = !audioAvailable;
    audioCheck.checked = audioAvailable && BdApi.Data.load("P2PShare", "captureAudio") !== false;
    audioLabel.textContent = audioAvailable ? "Transmitir \xE1udio" : nativeAudioBlocked() ? "\xC1udio desligado \u2014 a \xFAltima tentativa derrubou o Discord" : "\xC1udio indispon\xEDvel \u2014 componente ainda n\xE3o instalado";
    audioCheck.addEventListener("change", () => BdApi.Data.save("P2PShare", "captureAudio", audioCheck.checked));
    let settled = false;
    const settle = (id) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(id ? { id, audio: audioCheck.checked } : null);
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
var tileSessions = /* @__PURE__ */ new Map();
var poppedOut = /* @__PURE__ */ new Map();
function tilesOf(userId) {
  const safe = userId.replace(/[^\w-]/g, "");
  if (!safe) return [];
  return [...document.querySelectorAll(
    `[data-selenium-video-tile="${safe}"]`
  )];
}
function buildTileBar(sessionId, session2) {
  const bar = document.createElement("div");
  bar.className = "p2ps-tile-bar";
  const mkBtn = (text, title, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  };
  if (!session2.muted) {
    const vol = document.createElement("input");
    vol.type = "range";
    vol.min = "0";
    vol.max = "100";
    vol.value = String(Math.round(session2.volume * 100));
    vol.className = "p2ps-tile-vol";
    vol.title = "Volume";
    vol.addEventListener("mousedown", (e) => e.stopPropagation());
    vol.addEventListener("click", (e) => e.stopPropagation());
    vol.addEventListener("input", () => {
      session2.volume = Number(vol.value) / 100;
      if (session2.audio) session2.audio.volume = session2.volume;
    });
    bar.appendChild(vol);
  }
  bar.appendChild(mkBtn("\u26F6", "Tela cheia", () => {
    const video = bar.parentElement?.querySelector("video");
    void video?.requestFullscreen();
  }));
  bar.appendChild(mkBtn("\u29C9", "Abrir em janela solta", () => popOut(sessionId)));
  if (session2.closable) {
    bar.appendChild(mkBtn("\u2715", `Parar de assistir ${session2.title}`, session2.onClose));
  }
  return bar;
}
function applyTileVideos() {
  const claimed = /* @__PURE__ */ new Set();
  for (const [sessionId, session2] of tileSessions) {
    for (const tile of tilesOf(session2.userId)) {
      const child = tile.querySelector('[class*="tileChild"]') ?? tile;
      claimed.add(child);
      if (child.querySelector(".p2ps-tile-video")) continue;
      const video = document.createElement("video");
      video.className = "p2ps-tile-video";
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = session2.stream;
      child.appendChild(video);
      child.appendChild(buildTileBar(sessionId, session2));
    }
  }
  for (const el of document.querySelectorAll(".p2ps-tile-video")) {
    const child = el.parentElement;
    if (child && !claimed.has(child)) {
      el.remove();
      child.querySelector(".p2ps-tile-bar")?.remove();
    }
  }
}
function popOut(sessionId) {
  const session2 = tileSessions.get(sessionId);
  if (!session2) return;
  detachFromTiles(sessionId, { keepAudio: true });
  poppedOut.set(sessionId, session2);
  mountFloatingOverlay(sessionId, session2.stream, session2.title, session2.onClose, {
    muted: session2.muted,
    onDock: () => dockBack(sessionId)
  });
}
function dockBack(sessionId) {
  const session2 = poppedOut.get(sessionId);
  if (!session2) return;
  poppedOut.delete(sessionId);
  unmountFloatingOverlay(sessionId);
  tileSessions.set(sessionId, session2);
  applyTileVideos();
}
function detachFromTiles(sessionId, opts = {}) {
  const session2 = tileSessions.get(sessionId);
  if (!session2) return;
  tileSessions.delete(sessionId);
  for (const tile of tilesOf(session2.userId)) {
    tile.querySelector(".p2ps-tile-video")?.remove();
    tile.querySelector(".p2ps-tile-bar")?.remove();
  }
  if (!opts.keepAudio) {
    session2.audio?.pause();
    session2.audio?.remove();
    session2.audio = null;
  }
}
function mountFloatingOverlay(sessionId, stream, title, onClose, opts = {}) {
  unmountFloatingOverlay(sessionId);
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
  if (opts.onDock) {
    closeBtn.title = "Voltar para o quadro";
    closeBtn.addEventListener("click", opts.onDock);
    const stop = document.createElement("button");
    stop.type = "button";
    stop.textContent = "\u23F9";
    stop.title = `Parar de assistir ${title}`;
    stop.addEventListener("click", onClose);
    closeBtn.insertAdjacentElement("beforebegin", stop);
  } else {
    closeBtn.title = opts.closeLabel ?? "Fechar";
    closeBtn.addEventListener("click", onClose);
  }
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
function mountOverlay(sessionId, stream, title, onClose, opts = {}) {
  unmountOverlay(sessionId);
  if (opts.userId && tilesOf(opts.userId).length) {
    const session2 = {
      userId: opts.userId,
      stream,
      title,
      muted: opts.muted === true,
      closable: opts.closable !== false,
      onClose,
      audio: null,
      volume: 1
    };
    if (!session2.muted) {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.srcObject = stream;
      audio.style.display = "none";
      document.body.appendChild(audio);
      session2.audio = audio;
    }
    tileSessions.set(sessionId, session2);
    applyTileVideos();
    return;
  }
  mountFloatingOverlay(sessionId, stream, title, onClose, opts);
}
function unmountFloatingOverlay(sessionId) {
  const el = overlays.get(sessionId);
  if (!el) return;
  el.__p2psCleanupDrag?.();
  const video = el.querySelector("video");
  if (video) video.srcObject = null;
  el.remove();
  overlays.delete(sessionId);
}
function unmountOverlay(sessionId) {
  detachFromTiles(sessionId);
  poppedOut.delete(sessionId);
  const el = overlays.get(sessionId);
  if (!el) return;
  el.__p2psCleanupDrag?.();
  const video = el.querySelector("video");
  if (video) video.srcObject = null;
  el.remove();
  overlays.delete(sessionId);
}
function unmountAllOverlays() {
  for (const sessionId of [...tileSessions.keys()]) unmountOverlay(sessionId);
  for (const sessionId of [...poppedOut.keys()]) unmountOverlay(sessionId);
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
  onVoiceChannelChange,
  toast: (message, kind) => BdApi.UI.showToast(message, { type: TOAST_TYPE[kind] }),
  getBudgetMbps: () => loadSetting("uploadBudgetMbps", DEFAULT_BUDGET_MBPS),
  shouldCaptureAudio: () => loadSetting("captureAudio", true),
  getAudioDeviceId: () => loadSetting("audioDeviceId", null),
  captureIsolatedAudio: (sourceId) => captureIsolatedAudio(sourceId),
  pickSource: openSourcePicker,
  mountOverlay,
  unmountOverlay,
  unmountAllOverlays,
  setOverlayViewers,
  setLiveUsers,
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
  quality = {};
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
  /** Troca a qualidade em transmissao, sem recapturar a tela. */
  setQuality(quality2) {
    this.quality = quality2;
    this.applyBitrate();
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
        params.encodings[0].maxFramerate = this.quality.maxFramerate;
        params.encodings[0].scaleResolutionDownBy = this.quality.scaleResolutionDownBy ?? 1;
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
      if (pc.connectionState === "closed" || pc.connectionState === "disconnected") {
        this.fail("a transmiss\xE3o foi encerrada");
      }
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
  const visible = `# \u{1F534} ${username} est\xE1 transmitindo a tela
**J\xE1 tem o P2PShare?** Clique em **AO VIVO** no quadro dele na chamada e a tela abre por cima do avatar.
**Ainda n\xE3o tem?** [Baixar o instalador](${DOWNLOAD_URL})
-# V\xEDdeo ponto-a-ponto, direto entre os computadores. N\xE3o passa por servidor nenhum.`;
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
var DEFAULT_QUALITY = { maxHeight: null, maxFramerate: null };
var session = null;
var quality = { ...DEFAULT_QUALITY };
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
function getQuality() {
  return quality;
}
function setQuality(choice) {
  quality = choice;
  if (!session) return;
  const track = session.stream.getVideoTracks()[0];
  const sourceHeight = track?.getSettings().height;
  const encoding = {
    maxFramerate: choice.maxFramerate ?? void 0,
    scaleResolutionDownBy: choice.maxHeight && sourceHeight && sourceHeight > choice.maxHeight ? sourceHeight / choice.maxHeight : 1
  };
  session.peers.setQuality(encoding);
  if (track && choice.maxFramerate) {
    track.applyConstraints({ frameRate: { max: choice.maxFramerate } }).catch((err) => console.warn("[P2PShare] a captura recusou o fps pedido", err));
  }
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
  const audio = { stop: null };
  let stream;
  try {
    stream = await captureScreen(
      { pickSource: host.pickSource },
      {
        audio: host.shouldCaptureAudio(),
        audioDeviceId: host.getAudioDeviceId(),
        audioForSource: async (sourceId) => {
          const isolated = await host.captureIsolatedAudio(sourceId);
          audio.stop = isolated?.stop ?? null;
          return isolated?.track ?? null;
        }
      }
    );
  } catch (err) {
    audio.stop?.();
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
  const onVoiceChange = host.onVoiceChannelChange((id) => {
    if (id !== channelId) void stopBroadcast();
  });
  const onUnload = () => {
    session?.peers.closeAll();
    void stopBroadcast();
  };
  window.addEventListener("beforeunload", onUnload);
  const unwatchExit = () => {
    onVoiceChange();
    window.removeEventListener("beforeunload", onUnload);
  };
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
    unwatchExit();
    unsubscribe();
    stream.getTracks().forEach((track) => track.stop());
    audio.stop?.();
    host.toast(`n\xE3o deu para anunciar a transmiss\xE3o: ${err.message}`, "error");
    return;
  }
  session = {
    sessionId,
    channelId,
    beaconId,
    stream,
    peers,
    unsubscribe,
    unwatchExit,
    stopAudio: audio.stop ?? void 0
  };
  setQuality(quality);
  host.mountOverlay(
    selfPreviewKey(sessionId),
    stream,
    "Sua tela",
    () => host.unmountOverlay(selfPreviewKey(sessionId)),
    {
      muted: true,
      closable: false,
      userId: host.getCurrentUserId()
    }
  );
  notify();
  host.toast("Transmitindo via P2P", "success");
}
async function stopBroadcast() {
  const current = session;
  if (!current) return;
  session = null;
  host.unmountOverlay(selfPreviewKey(current.sessionId));
  current.unwatchExit();
  current.unsubscribe();
  current.peers.closeAll();
  current.stream.getTracks().forEach((track) => track.stop());
  current.stopAudio?.();
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
function getActiveBeacons() {
  return [...beacons.values()];
}
function onBeaconsChange(listener) {
  beaconListeners.add(listener);
  return () => beaconListeners.delete(listener);
}
function isWatching(sessionId) {
  return watching.has(sessionId);
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
  notifyBeacons();
  peer.onStream = (stream) => {
    host.mountOverlay(
      beacon.sessionId,
      stream,
      beacon.broadcasterName,
      () => stopWatching(beacon.sessionId),
      {
        closeLabel: `Parar de assistir ${beacon.broadcasterName}`,
        userId: beacon.broadcasterId
      }
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
  notifyBeacons();
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
    const res = BdApi.Net?.fetch ? await BdApi.Net.fetch(UPDATE_URL, { redirect: "follow" }) : await fetch(UPDATE_URL, { cache: "no-store" });
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
  cleanupBeacons = null;
  start() {
    ui_exports.injectStyles();
    const toggle = (anchor) => {
      if (!getBroadcastState().active) {
        void startBroadcast();
        return;
      }
      ui_exports.openBroadcastMenu(anchor, {
        quality: getQuality(),
        onQuality: (q) => setQuality(q),
        onStop: () => {
          void stopBroadcast();
        }
      });
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
    const refreshLive = () => {
      const users = [];
      if (getBroadcastState().active) {
        const me = getCurrentUserId();
        users.push({ id: me, names: [getUsername(me), getCurrentUsername()] });
      }
      for (const b of getActiveBeacons()) {
        users.push({
          id: b.broadcasterId,
          names: [getUsername(b.broadcasterId), b.broadcasterName],
          // Já assistindo: o selo vira informativo, sem ação repetida.
          onWatch: isWatching(b.sessionId) ? void 0 : () => {
            ui_exports.focusChannel(b.channelId);
            void startWatching(b);
          }
        });
      }
      ui_exports.setLiveUsers(users);
    };
    this.cleanupBeacons = onBeaconsChange(refreshLive);
    this.cleanupState = onBroadcastStateChange((state) => {
      ui_exports.updateLauncher(state);
      ui_exports.updateVoiceButton(state);
      refreshLive();
    });
    this.cleanupUpdater = startUpdateChecks();
    checkPreviousCrash();
    void syncHelper();
    setTimeout(() => ui_exports.dumpVoiceDiagnostics(), 8e3);
  }
  stop() {
    void stopBroadcast();
    this.cleanupState?.();
    this.cleanupState = null;
    this.cleanupBeacons?.();
    this.cleanupBeacons = null;
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
    const audio = document.createElement("label");
    audio.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:20px;cursor:pointer";
    const audioCheck = document.createElement("input");
    audioCheck.type = "checkbox";
    audioCheck.checked = loadSetting("captureAudio", true);
    audioCheck.addEventListener("change", () => saveSetting("captureAudio", audioCheck.checked));
    const audioText = document.createElement("span");
    audioText.textContent = "Transmitir o \xE1udio do sistema";
    audio.append(audioCheck, audioText);
    const audioHint = document.createElement("div");
    audioHint.textContent = "O Windows s\xF3 permite capturar o \xE1udio inteiro da m\xE1quina, e isso inclui o pr\xF3prio Discord \u2014 quem assiste ouve a chamada de volta. Desligue se isso incomodar.";
    audioHint.style.cssText = "font-size:12px;color:var(--text-muted,#72767d);margin-top:4px";
    const modeLabel = document.createElement("div");
    modeLabel.textContent = "\xC1udio da transmiss\xE3o";
    modeLabel.style.cssText = "margin-top:20px;margin-bottom:4px";
    const modeHint = document.createElement("div");
    modeHint.textContent = "O \xE1udio acompanha o que voc\xEA compartilha: escolhendo uma janela, vai s\xF3 o som daquele programa; escolhendo um monitor, vai tudo menos o Discord \u2014 assim quem assiste n\xE3o ouve a pr\xF3pria chamada de volta. Isso depende de um programa auxiliar de 140 KB, que o plugin instala sozinho.";
    modeHint.style.cssText = "font-size:12px;color:var(--text-muted,#72767d);margin-bottom:8px";
    const helperRow = document.createElement("div");
    helperRow.style.cssText = "display:flex;align-items:center;gap:10px;font-size:12px";
    const helperStatus = document.createElement("span");
    const helperBtn = document.createElement("button");
    helperBtn.type = "button";
    helperBtn.style.cssText = "padding:5px 10px;border:none;border-radius:3px;cursor:pointer;color:#fff;font-size:12px;flex-shrink:0";
    const paintHelper = () => {
      const ready = helperReady();
      const err = helperError();
      const blocked = nativeAudioBlocked();
      helperStatus.textContent = blocked ? "Desligado por seguran\xE7a: a \xFAltima tentativa derrubou o Discord." : ready ? "Componente de \xE1udio instalado." : err ? `N\xE3o deu para instalar: ${err}` : "Instalando o componente de \xE1udio\u2026";
      helperStatus.style.color = ready ? "var(--text-positive, #23a55a)" : "var(--text-muted, #72767d)";
      helperBtn.textContent = blocked ? "Ligar de novo" : ready ? "Desinstalar" : "Tentar de novo";
      helperBtn.style.background = ready && !blocked ? "var(--status-danger, #ed4245)" : "var(--brand-experiment, #5865f2)";
    };
    helperBtn.addEventListener("click", async () => {
      helperBtn.disabled = true;
      if (nativeAudioBlocked()) {
        unblockNativeAudio();
      } else if (helperReady()) {
        removeHelper();
      } else {
        helperBtn.textContent = "Baixando\u2026";
        await ensureHelper();
      }
      helperBtn.disabled = false;
      paintHelper();
    });
    helperRow.append(helperStatus, helperBtn);
    paintHelper();
    const timer = setInterval(() => {
      if (!wrap.isConnected) {
        clearInterval(timer);
        return;
      }
      paintHelper();
    }, 1500);
    wrap.append(
      label,
      hint,
      slider,
      auto,
      autoHint,
      audio,
      audioHint,
      modeLabel,
      modeHint,
      helperRow
    );
    return wrap;
  }
};
module.exports = module.exports.default;
