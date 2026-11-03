/**
 * @name P2PShare
 * @author Andrew
 * @description Compartilhamento de tela ponto-a-ponto via WebRTC, sem passar pela infra de video do Discord e sem servidor proprio.
 * @version 1.21.2
 * @source https://github.com/andrewmautone/discord-p2pshare
 */
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
var __toCommonJS = (mod2) => __copyProps(__defProp({}, "__esModule", { value: true }), mod2);

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
var PLUGIN_VERSION = "1.21.2";
var HELPER_TAG = "audio-v2";
var HELPER_URL = `https://github.com/andrewmautone/discord-p2pshare/releases/download/${HELPER_TAG}/p2pshare-audio.exe`;
var HELPER_SHA256 = "f78221d17c22d2cdc8c4067a9c27e8791c78f88eda70561258b1b80f235936e5";
var UPDATE_URL = "https://raw.githubusercontent.com/andrewmautone/discord-p2pshare/main/release/P2PShare.plugin.js";
var VERSION_URL = "https://raw.githubusercontent.com/andrewmautone/discord-p2pshare/main/release/VERSION";
var ICE_SERVERS = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.nextcloud.com:3478" },
  { urls: "stun:stun.relay.metered.ca:80" }
];
var ZW_CODEPOINTS = [8203, 8204, 8205, 8288];
var ZW_DIGITS = ZW_CODEPOINTS.map((c) => String.fromCodePoint(c));
var ZW_DELIM = String.fromCodePoint(8290);
var MIN_BITRATE = 8e5;
var MAX_BITRATE = 8e6;
var DEFAULT_BUDGET_MBPS = 15;
var ICE_GATHER_TIMEOUT_MS = 4e3;
var PEER_CONNECT_TIMEOUT_MS = 3e4;
var PEER_DROP_GRACE_MS = 12e3;
var RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.snort.social",
  "wss://offchain.pub"
];

// codec.ts
var DIGIT_INDEX = new Map(ZW_DIGITS.map((c, i) => [c, i]));
function newSessionId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => (b % 36).toString(36)).join("");
}

// host/bd/api.ts
var { getModule } = BdApi.Webpack;
function isImpostor(m) {
  try {
    if (m === window || m === document) return true;
    if (m?.[Symbol.toStringTag] === "IntlMessagesProxy") return true;
    return m != null && typeof m === "object" && m["__p2pshare_inexistente__"] !== void 0;
  } catch {
    return true;
  }
}
function guard(filter) {
  return (m) => !isImpostor(m) && filter(m);
}
function lookup(rawFilter) {
  const filter = guard(rawFilter);
  let found = getModule(filter);
  if (found === void 0) {
    found = getModule(filter, { searchExports: true });
  }
  if (found === void 0) {
    const wrapper = getModule((m) => m?.default && filter(m.default));
    if (wrapper) found = wrapper.default;
  }
  return found ?? void 0;
}
function find(name, filter) {
  let cached;
  return () => {
    if (cached !== void 0) return cached;
    cached = lookup(filter);
    if (cached === void 0) {
      throw new Error(
        `[P2PShare] n\xE3o encontrei o m\xF3dulo ${name} no Discord. Provavelmente o Discord mudou a estrutura interna \u2014 reporte com este nome.`
      );
    }
    return cached;
  };
}
function findOptional(filter) {
  let cached;
  let resolved = false;
  return () => {
    if (resolved) return cached;
    resolved = true;
    try {
      cached = lookup(filter);
    } catch {
      cached = void 0;
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
var MessageStore = findOptional(
  (m) => m?.getMessages && m?.getMessage && m?.getLastMessage
);
function nonce() {
  const DISCORD_EPOCH = 1420070400000n;
  return (BigInt(Date.now()) - DISCORD_EPOCH << 22n).toString();
}
function hasCurrentUser() {
  try {
    return Boolean(UserStore().getCurrentUser()?.id);
  } catch {
    return false;
  }
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
var HISTORY_LIMIT = 50;
async function fetchRecentMessages(channelId, limit = HISTORY_LIMIT) {
  const cached = readCachedMessages(channelId, limit);
  if (cached.length > 0) return cached;
  try {
    const rest = RestAPI();
    if (typeof rest.get !== "function") return [];
    const res = await rest.get({
      url: `/channels/${channelId}/messages?limit=${limit}`
    });
    return normalizeMessages(res?.body, channelId, limit);
  } catch (err) {
    console.warn("[P2PShare] n\xE3o deu para buscar o hist\xF3rico do canal", err);
    return [];
  }
}
function readCachedMessages(channelId, limit) {
  try {
    const store = MessageStore();
    if (!store) return [];
    const cache = store.getMessages(channelId);
    if (!cache || cache.ready === false) return [];
    const list = toArray(cache).slice(-limit).reverse();
    return normalizeMessages(list, channelId, limit);
  } catch (err) {
    console.warn("[P2PShare] cache de mensagens indispon\xEDvel", err);
    return [];
  }
}
function toArray(cache) {
  if (Array.isArray(cache)) return cache;
  if (typeof cache.toArray === "function") return cache.toArray() ?? [];
  if (Array.isArray(cache._array)) return cache._array;
  return [];
}
function normalizeMessages(raw, channelId, limit) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw.slice(0, limit)) {
    if (typeof m?.id !== "string" || typeof m?.content !== "string") continue;
    if (typeof m?.author?.id !== "string") continue;
    out.push({
      id: m.id,
      // Registro de cache nem sempre carrega o canal; sem ele o
      // handshake sairia sem destino, então o canal pedido é a verdade.
      channel_id: m.channel_id ?? m.channelId ?? channelId,
      content: m.content,
      author: { id: m.author.id, username: m.author.username ?? m.author.id },
      attachments: Array.isArray(m.attachments) ? m.attachments : []
    });
  }
  return out;
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
function byStoreName(name) {
  return (m) => typeof m?.getName === "function" && m.getName() === name;
}
var SelectedGuildStore = findOptional(byStoreName("SelectedGuildStore"));
var GuildChannelStore = findOptional(byStoreName("GuildChannelStore"));
var ChannelStore = findOptional(byStoreName("ChannelStore"));
var VoiceStateStore = findOptional(byStoreName("VoiceStateStore"));
function getSelectedGuildId() {
  try {
    return SelectedGuildStore()?.getGuildId?.() ?? null;
  } catch {
    return null;
  }
}
function getChannelGuildId(channelId) {
  try {
    return ChannelStore()?.getChannel?.(channelId)?.guild_id ?? null;
  } catch {
    return null;
  }
}
function getGuildVoiceChannelIds(guildId) {
  try {
    const groups = GuildChannelStore()?.getChannels?.(guildId);
    const vocal = groups?.VOCAL ?? [];
    return vocal.map((entry) => entry?.channel?.id ?? entry?.id).filter((id) => typeof id === "string");
  } catch {
    return [];
  }
}
function isUserInVoiceChannel(userId, channelId) {
  try {
    const states = VoiceStateStore()?.getVoiceStatesForChannel?.(channelId);
    if (!states) return false;
    if (states instanceof Map) return states.has(userId);
    if (Array.isArray(states)) return states.some((s) => (s?.userId ?? s?.user_id) === userId);
    if (userId in states) return true;
    return Object.values(states).some((s) => (s?.userId ?? s?.user_id) === userId);
  } catch {
    return false;
  }
}
function onNavigationChange(handler) {
  const events = ["CHANNEL_SELECT", "GUILD_CREATE", "CHANNEL_CREATE", "CHANNEL_DELETE", "VOICE_STATE_UPDATES"];
  const listener = () => {
    try {
      handler();
    } catch (err) {
      console.error("[P2PShare] handler de navega\xE7\xE3o falhou", err);
    }
  };
  for (const e of events) FluxDispatcher().subscribe(e, listener);
  return () => {
    for (const e of events) FluxDispatcher().unsubscribe(e, listener);
  };
}
var nativeSockets = /* @__PURE__ */ new Map();
var nativeHooked = false;
function nativeRelay() {
  const relay = globalThis.P2PShareNative?.relay;
  if (!relay) return null;
  if (!nativeHooked) {
    nativeHooked = true;
    relay.onEvent((id, type, data) => {
      const s = nativeSockets.get(id);
      if (!s) return;
      if (type === "open") s.onopen?.();
      else if (type === "message") s.onmessage?.(String(data ?? ""));
      else if (type === "close") {
        nativeSockets.delete(id);
        s.onclose?.();
      }
    });
  }
  return relay;
}
function openRelaySocket(url) {
  const native = nativeRelay();
  if (native) {
    let id = null;
    let closed = false;
    const socket2 = {
      onopen: null,
      onmessage: null,
      onclose: null,
      send: (data) => {
        if (id !== null) native.send(id, data);
      },
      close: () => {
        closed = true;
        if (id !== null) {
          native.close(id);
          nativeSockets.delete(id);
        }
      }
    };
    native.open(url).then(
      (got) => {
        id = got;
        if (closed) {
          native.close(got);
          return;
        }
        nativeSockets.set(got, socket2);
      },
      () => setTimeout(() => socket2.onclose?.(), 0)
    );
    return socket2;
  }
  const ws = new WebSocket(url);
  const socket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    send: (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close: () => ws.close()
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (e) => socket.onmessage?.(String(e.data));
  ws.onclose = () => socket.onclose?.();
  ws.onerror = () => {
  };
  return socket;
}

// binary.ts
function toBytes(data) {
  if (typeof data !== "string") return new Uint8Array(data);
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 255;
  return bytes;
}

// host/bd/audioHelper.ts
function beside(name) {
  return require("path").join(BdApi.Plugins.folder, name);
}
function newToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function request(ep, path, params = {}, signal) {
  const query = new URLSearchParams({ token: ep.token, ...params });
  return fetch(`http://127.0.0.1:${ep.port}${path}?${query}`, { signal });
}
async function alive(ep) {
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 1500);
    const res = await request(ep, "/ping", {}, abort.signal);
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
async function waitForPort(deadlineMs = 8e3) {
  const fs = require("fs");
  const file = beside("p2pshare-audio.port");
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      if (fs.existsSync(file)) {
        const port = parseInt(String(fs.readFileSync(file, "utf8")).trim(), 10);
        if (port > 0) return port;
      }
    } catch {
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  let motivo = "";
  try {
    motivo = String(fs.readFileSync(beside("p2pshare-audio.log"), "utf8")).trim();
  } catch {
  }
  throw new Error(motivo || "o componente de \xE1udio n\xE3o respondeu a tempo");
}
var endpoint = null;
var starting = null;
async function startServer() {
  const exe = await ensureHelper();
  if (!exe) return null;
  const fs = require("fs");
  const token = newToken();
  fs.writeFileSync(beside("p2pshare-audio.token"), token, "utf8");
  for (const resto of ["p2pshare-audio.port", "p2pshare-audio.log"]) {
    try {
      if (fs.existsSync(beside(resto))) fs.unlinkSync(beside(resto));
    } catch {
    }
  }
  const { shell } = require("electron");
  const problema = await shell.openPath(exe);
  if (problema) throw new Error(problema);
  return { port: await waitForPort(), token };
}
async function helperEndpoint() {
  if (endpoint && await alive(endpoint)) return endpoint;
  starting ??= startServer().then((ep) => {
    endpoint = ep;
    return ep;
  }).catch((err) => {
    lastError = err.message;
    recordDiagnostics();
    console.warn("[P2PShare] n\xE3o deu para iniciar o componente de \xE1udio", err);
    return null;
  }).finally(() => {
    starting = null;
  });
  return starting;
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
function readBinaryFile(file) {
  const fs = require("fs");
  const { size } = fs.statSync(file);
  const tentativas = [
    () => fs.readFileSync(file, { encoding: null }),
    () => fs.readFileSync(file, "latin1"),
    () => fs.readFileSync(file)
  ];
  for (const ler of tentativas) {
    try {
      const bytes = toBytes(ler());
      if (bytes.length === size) return bytes;
    } catch {
    }
  }
  throw new Error(`n\xE3o deu para ler ${size} bytes de ${file} sem corromper`);
}
var lastValidityProblem = null;
function localHelperIsValid() {
  let file = "(caminho n\xE3o resolvido)";
  try {
    const fs = require("fs");
    file = helperPath();
    if (!fs.existsSync(file)) {
      lastValidityProblem = `n\xE3o existe: ${file}`;
      return false;
    }
    const bytes = readBinaryFile(file);
    const digest = sha256(bytes);
    if (digest !== HELPER_SHA256) {
      lastValidityProblem = `hash diferente (${bytes.length} bytes): disco ${digest.slice(0, 12)}, esperado ${HELPER_SHA256.slice(0, 12)}`;
      return false;
    }
    lastValidityProblem = null;
    return true;
  } catch (err) {
    lastValidityProblem = `erro ao conferir ${file}: ${err?.message ?? String(err)}`;
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
        motivoDaRecusa: lastValidityProblem,
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
  recordDiagnostics();
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
function pcmParams(sourceId) {
  const [kind, handle] = sourceId.split(":");
  if (kind === "window" && handle) {
    return { mode: "window", target: handle };
  }
  return { mode: "exclude", target: String(discordTreePid()) };
}
async function captureIsolatedAudio(sourceId) {
  const ep = await helperEndpoint();
  if (!ep) {
    console.info("[P2PShare] componente de \xE1udio ausente, usando o \xE1udio do sistema");
    return null;
  }
  try {
    const abort = new AbortController();
    const res = await request(ep, "/pcm", pcmParams(sourceId), abort.signal);
    if (!res.ok || !res.body) {
      throw new Error(`o componente respondeu ${res.status}`);
    }
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    const destination = context.createMediaStreamDestination();
    const ring = new Float32Array(RING_FRAMES * CHANNELS);
    let writeAt = 0;
    let readAt = 0;
    let available = 0;
    let leftover = new Uint8Array(0);
    const alimenta = (chunk) => {
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
    };
    const reader = res.body.getReader();
    void (async () => {
      try {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) alimenta(new Uint8Array(value));
        }
      } catch {
      }
    })();
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
      abort.abort();
      node.onaudioprocess = null;
      node.disconnect();
      void context.close();
    };
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
  hasNativeGoLive: () => hasNativeGoLive,
  injectStyles: () => injectStyles,
  mountLauncher: () => mountLauncher,
  mountOverlay: () => mountOverlay,
  mountVoiceButton: () => mountVoiceButton,
  openBroadcastMenu: () => openBroadcastMenu,
  openNativeGoLive: () => openNativeGoLive,
  openSourcePicker: () => openSourcePicker,
  removeStyles: () => removeStyles,
  revokeBeacon: () => revokeBeacon,
  setLauncherHidden: () => setLauncherHidden,
  setLiveUsers: () => setLiveUsers,
  setNativeButtonMode: () => setNativeButtonMode,
  setOverlayViewers: () => setOverlayViewers,
  unmountAllOverlays: () => unmountAllOverlays,
  unmountLauncher: () => unmountLauncher,
  unmountOverlay: () => unmountOverlay,
  updateLauncher: () => updateLauncher,
  updateVoiceButton: () => updateVoiceButton
});

// bitrate.ts
function computePerPeerBitrate(budgetMbps, viewerCount) {
  if (viewerCount <= 0) return MAX_BITRATE;
  const perPeer = budgetMbps * 1e6 / viewerCount;
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, perPeer)));
}
function smoothBudgetMbps(previous, sampleMbps) {
  if (!Number.isFinite(sampleMbps) || sampleMbps <= 0) return previous ?? 0;
  if (previous === null || previous <= 0) return sampleMbps;
  const peso = sampleMbps < previous ? 0.6 : 0.2;
  return previous + (sampleMbps - previous) * peso;
}
function usableBudgetMbps(samplesMbps) {
  const validos = samplesMbps.filter((v) => Number.isFinite(v) && v > 0);
  if (!validos.length) return null;
  return Math.max(...validos);
}
function formatMbps(bps) {
  return `${(bps / 1e6).toFixed(1).replace(".", ",")} Mb/s`;
}

// golive.ts
function isShareScreenLabel(label) {
  const l = label.toLowerCase();
  if (!/compartilh|share/.test(l)) return false;
  return !/cheia|fullscreen|convite|invite|link|atividade|activit/.test(l);
}
var SHARE_ARROW_PATH = "1.4l3-3a1 1 0 0 0 0-1.4l-3-3";
var BLOCKED_BADGE_PATH = "M15.46 15.46a5 5 0 0 1 7.07 0";
function isShareScreenIcon(paths) {
  return paths.some((d) => d.includes(SHARE_ARROW_PATH) || d.startsWith("M2 4.5C2 3.397"));
}
function isBlockedIcon(paths) {
  return paths.some((d) => d.startsWith(BLOCKED_BADGE_PATH));
}
function offersShare(label, paths) {
  return label ? isShareScreenLabel(label) : isShareScreenIcon(paths);
}
function shouldIntercept(ctx) {
  if (ctx.bypass || ctx.mode !== "p2p") return false;
  if (ctx.shiftKey) return false;
  if (ctx.p2pActive) return true;
  return ctx.nativeOffersShare;
}

// host/bd/ui.ts
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
/* Botao nativo do Discord assumido pelo P2PShare. Marcado por atributo, nao
   por classe: o React reescreve o className a cada mudanca de estado. */
[data-p2ps-native] { position: relative; }
/* Botao "indisponivel" assumido: some o icone de bloqueio, fica o nosso. */
[data-p2ps-unavail] svg:not(.p2ps-icon) { display: none !important; }
/* Tooltip do Discord com o nosso texto: o original (do React) fica oculto. */
[data-p2ps-tip] { font-size: 0 !important; }
[data-p2ps-tip]::after {
    content: attr(data-p2ps-tip);
    font-size: 14px;
    line-height: 18px;
}
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
/* A linha da barra lateral \xE9 bem mais baixa e estreita que a da chamada: com
   o tamanho do selo de dentro da chamada ela cresce e desalinha o canal. */
.p2ps-live-chip-side {
    margin-left: 4px;
    padding: 0 4px;
    font-size: 8px;
    line-height: 12px;
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
var NATIVE_ATTR = "data-p2ps-native";
var LABEL_ATTR = "data-p2ps-label";
var voiceBtns = /* @__PURE__ */ new Set();
var voiceObserver = null;
var lastState = { active: false, viewers: 0 };
var nativeMode = "p2p";
var bypassClick = false;
var onNativeToggle = null;
function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
var isOurs = (el) => !!el?.closest('[class*="p2ps-"]');
function nativeLabelOf(btn) {
  return btn.getAttribute(LABEL_ATTR) ?? btn.getAttribute("aria-label") ?? "";
}
function findNativeButtons() {
  const found = /* @__PURE__ */ new Set();
  for (const btn of document.querySelectorAll(`[${NATIVE_ATTR}]`)) {
    found.add(btn);
  }
  const byIcon = `button svg path[d^="M2 4.5C2 3.397"], button svg path[d*="${SHARE_ARROW_PATH}"]`;
  for (const path of document.querySelectorAll(byIcon)) {
    if (path.closest(".p2ps-icon")) continue;
    const btn = path.closest("button");
    if (btn && !isOurs(btn)) found.add(btn);
  }
  for (const btn of document.querySelectorAll("button[aria-label]")) {
    if (isOurs(btn)) continue;
    if (isShareScreenLabel(btn.getAttribute("aria-label") || "")) found.add(btn);
  }
  for (const btn of found) {
    if (!btn.hasAttribute(NATIVE_ATTR)) btn.setAttribute(NATIVE_ATTR, "");
  }
  return [...found];
}
function nativePathsOf(btn) {
  return [...btn.querySelectorAll("svg:not(.p2ps-icon) path")].map((p) => p.getAttribute("d") ?? "");
}
var UNAVAIL_ATTR = "data-p2ps-unavail";
var TIP_ATTR = "data-p2ps-tip";
function tipText() {
  return lastState.active ? `Parar transmiss\xE3o P2P \u2014 ${lastState.viewers} assistindo` : "Transmitir tela via P2P";
}
function patchTooltips() {
  if (nativeMode !== "p2p") return;
  const text = tipText();
  for (const btn of document.querySelectorAll(`[${UNAVAIL_ATTR}]`)) {
    const id = btn.getAttribute("aria-describedby");
    if (!id) continue;
    const quoted = id.replace(/["\\]/g, "\\$&");
    const sel = `[role="tooltip"][id="${quoted}"] [data-text-variant]`;
    for (const el of document.querySelectorAll(sel)) {
      if (el.getAttribute(TIP_ATTR) !== text) el.setAttribute(TIP_ATTR, text);
    }
  }
}
function paintUnavailable(btn) {
  const blocked = nativeMode === "p2p" && isBlockedIcon(nativePathsOf(btn));
  const ours = btn.querySelector("svg.p2ps-icon");
  if (!blocked) {
    btn.removeAttribute(UNAVAIL_ATTR);
    ours?.remove();
    return;
  }
  if (!btn.hasAttribute(UNAVAIL_ATTR)) btn.setAttribute(UNAVAIL_ATTR, "");
  if (ours) return;
  const native = btn.querySelector("svg:not(.p2ps-icon)");
  if (!native?.parentElement) return;
  const tpl = document.createElement("template");
  tpl.innerHTML = SCREENSHARE_SVG;
  const icon = tpl.content.firstElementChild;
  icon.setAttribute("class", `${native.getAttribute("class") ?? ""} p2ps-icon`.trim());
  icon.setAttribute("width", native.getAttribute("width") ?? "24");
  icon.setAttribute("height", native.getAttribute("height") ?? "24");
  icon.setAttribute("aria-hidden", "true");
  native.parentElement.appendChild(icon);
}
function paintOne(btn) {
  const ours = nativeMode === "p2p" && lastState.active;
  paintUnavailable(btn);
  for (const svg of btn.querySelectorAll("svg")) {
    svg.style.color = ours ? "var(--status-danger, #ed4245)" : "";
  }
  if (ours) {
    if (!btn.hasAttribute(LABEL_ATTR)) {
      btn.setAttribute(LABEL_ATTR, btn.getAttribute("aria-label") ?? "");
    }
    const label = `Parar transmiss\xE3o P2P \u2014 ${lastState.viewers} assistindo`;
    if (btn.getAttribute("aria-label") !== label) btn.setAttribute("aria-label", label);
  } else if (btn.hasAttribute(LABEL_ATTR)) {
    btn.setAttribute("aria-label", btn.getAttribute(LABEL_ATTR) ?? "");
    btn.removeAttribute(LABEL_ATTR);
  }
  const want = ours && lastState.viewers > 0 ? String(lastState.viewers) : null;
  const badge = btn.querySelector(".p2ps-voice-count");
  if (!want) {
    badge?.remove();
  } else if (!badge) {
    const el = document.createElement("span");
    el.className = "p2ps-voice-count";
    el.textContent = want;
    btn.appendChild(el);
  } else if (badge.textContent !== want) {
    badge.textContent = want;
  }
}
function releaseNative(btn) {
  for (const svg of btn.querySelectorAll("svg")) svg.style.color = "";
  btn.querySelector("svg.p2ps-icon")?.remove();
  btn.removeAttribute(UNAVAIL_ATTR);
  if (btn.hasAttribute(LABEL_ATTR)) {
    btn.setAttribute("aria-label", btn.getAttribute(LABEL_ATTR) ?? "");
    btn.removeAttribute(LABEL_ATTR);
  }
  btn.querySelector(".p2ps-voice-count")?.remove();
  btn.removeAttribute(NATIVE_ATTR);
}
function onNativeClick(e) {
  const target = e.target;
  const btn = target?.closest?.(`[${NATIVE_ATTR}]`);
  if (!btn || !onNativeToggle) return;
  const take = shouldIntercept({
    mode: nativeMode,
    bypass: bypassClick,
    shiftKey: e.shiftKey,
    p2pActive: lastState.active,
    nativeOffersShare: offersShare(nativeLabelOf(btn), nativePathsOf(btn))
  });
  if (!take) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  onNativeToggle(btn);
}
function setNativeButtonMode(mode) {
  nativeMode = mode;
  for (const btn of voiceBtns) paintOne(btn);
}
function hasNativeGoLive() {
  return findNativeButtons().some((b) => isVisible(b) && !isBlockedIcon(nativePathsOf(b)));
}
function openNativeGoLive() {
  const btn = findNativeButtons().find(isVisible);
  if (!btn) return false;
  bypassClick = true;
  try {
    btn.click();
  } finally {
    bypassClick = false;
  }
  return true;
}
function mountVoiceButton(opts) {
  onNativeToggle = opts.onToggle;
  nativeMode = opts.mode;
  window.addEventListener("click", onNativeClick, true);
  const sync = () => {
    for (const btn of voiceBtns) {
      if (!btn.isConnected) voiceBtns.delete(btn);
    }
    for (const btn of findNativeButtons()) {
      voiceBtns.add(btn);
      paintOne(btn);
    }
    opts.onAnchorChange(nativeMode === "p2p" && [...voiceBtns].some(isVisible));
    applyLiveBadges();
    applySidebarBadges();
    applyTileBadges();
    applyTileVideos();
    dumpVoiceDiagnostics();
  };
  sync();
  let queued = false;
  let fallback = null;
  const run = () => {
    queued = false;
    if (fallback !== null) {
      clearTimeout(fallback);
      fallback = null;
    }
    sync();
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
    fallback = setTimeout(run, 250);
  };
  voiceObserver = new MutationObserver(() => {
    schedule();
    try {
      patchTooltips();
    } catch (err) {
      console.warn("[P2PShare] tooltip do bot\xE3o nativo", err);
    }
  });
  voiceObserver.observe(document.body, { childList: true, subtree: true });
  const heartbeat = setInterval(sync, 1e3);
  return () => {
    clearInterval(heartbeat);
    if (fallback !== null) clearTimeout(fallback);
    voiceObserver?.disconnect();
    voiceObserver = null;
    window.removeEventListener("click", onNativeClick, true);
    onNativeToggle = null;
    for (const btn of voiceBtns) releaseNative(btn);
    voiceBtns.clear();
    removeSidebarBadges();
  };
}
var lastDumpKey = "";
function dumpVoiceDiagnostics() {
  try {
    const natives = [...voiceBtns];
    const video = {
      noQuadro: [...tileSessions.keys()],
      emJanela: [...poppedOut.keys()],
      sobreposicoes: [...overlays.keys()],
      porSessao: [...tileSessions].map(([id, sess]) => {
        const quadros = tilesOf(sess.userId);
        return {
          sessao: id,
          usuario: sess.userId,
          quadrosAchados: quadros.length,
          comVideo: quadros.filter((t) => t.querySelector(".p2ps-tile-video")).length,
          trilhasVivas: sess.stream.getVideoTracks().filter((t) => t.readyState === "live").length
        };
      }),
      videosNoDom: document.querySelectorAll(".p2ps-tile-video").length
    };
    const key = nativeMode + "#" + natives.length + ":" + natives.filter(isVisible).length + "#" + sidebarDiag.estrategiaEscolhida + ":" + sidebarDiag.linhas + ":" + sidebarDiag.selosAtivos + "#" + JSON.stringify(video);
    if (key === lastDumpKey) return;
    lastDumpKey = key;
    const data = {
      quando: (/* @__PURE__ */ new Date()).toISOString(),
      botaoNativo: nativeMode,
      botoesNativos: natives.map((b) => {
        const r = b.getBoundingClientRect();
        return {
          visivel: isVisible(b),
          tamanho: `${Math.round(r.width)}x${Math.round(r.height)}`,
          pos: `${Math.round(r.x)},${Math.round(r.y)}`
        };
      }),
      flutuante: launcher ? launcher.classList.contains("p2ps-launcher-hidden") ? "escondido" : "visivel" : "nao montado",
      // Qual estrategia de ancoragem venceu na barra lateral e quantas
      // linhas cada uma acharia: e' o que diz se o seletor ainda existe.
      seloBarraLateral: {
        ...sidebarDiag,
        transmitindo: liveUsers.length
      },
      video
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
  for (const btn of voiceBtns) paintOne(btn);
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
    const chip = buildLiveChip(user);
    const slot = row.querySelector('[class*="content__"]') ?? row.querySelector('[class*="chipletParent"]') ?? nameEl?.parentElement;
    slot?.appendChild(chip);
  }
}
function buildLiveChip(user, channelId) {
  const chip = document.createElement("span");
  chip.className = "p2ps-live-chip";
  chip.textContent = "AO VIVO";
  const act = user?.onWatch ?? (channelId ? () => focusChannel(channelId) : null);
  if (act) {
    chip.classList.add("p2ps-clickable");
    chip.title = user?.onWatch ? "Clique para assistir" : "Clique para abrir o canal";
    chip.setAttribute("role", "button");
    chip.tabIndex = 0;
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      act();
    };
    chip.addEventListener("mousedown", (e) => e.stopPropagation());
    chip.addEventListener("click", open);
  } else {
    chip.title = "Transmitindo via P2PShare";
  }
  return chip;
}
var CHANNEL_ITEM_PREFIX = "channels___";
var CHANNEL_ITEM = `[data-list-item-id^="${CHANNEL_ITEM_PREFIX}"]`;
var SIDEBAR_SCOPE = 'nav, [class*="sidebar"], [class*="channelList"], [class*="privateChannels"]';
function channelIdOf(el) {
  const raw = el.closest(CHANNEL_ITEM)?.getAttribute("data-list-item-id") ?? "";
  return raw.slice(CHANNEL_ITEM_PREFIX.length) || null;
}
function climbToRow(el, scope) {
  const marked = el.closest(
    'li, [role="listitem"], [class*="voiceUser"], [class*="userItem"]'
  );
  if (marked && marked !== scope && scope.contains(marked)) return marked;
  let node = el;
  while (node.parentElement && node.parentElement !== scope) node = node.parentElement;
  return node;
}
var SIDEBAR_STRATEGIES = [
  {
    // O caso esperado: o Discord pendura os conectados dentro do proprio
    // item do canal, com a mesma classe de linha usada na chamada.
    name: "channel-item-voiceuser",
    rows: () => [...document.querySelectorAll(CHANNEL_ITEM)].flatMap((item) => [...item.querySelectorAll('[class*="voiceUser"]')].map((el) => ({ el, channelId: channelIdOf(item) })))
  },
  {
    // A lista pode ser irma do item do canal, e nao filha; ai' o id do
    // canal so' aparece se algum ancestral comum ainda o carregar.
    name: "voice-users-list",
    rows: () => [...document.querySelectorAll('[class*="voiceUsers"]')].flatMap((list) => [...list.children]).map((el) => ({ el, channelId: channelIdOf(el) }))
  },
  {
    // Sem o item do canal por perto, sobra reconhecer a linha pela classe
    // e confiar no escopo para nao invadir o painel da chamada.
    name: "sidebar-voiceuser",
    rows: () => [...document.querySelectorAll(SIDEBAR_SCOPE)].flatMap((scope) => [...scope.querySelectorAll('[class*="voiceUser"]')]).map((el) => ({ el, channelId: channelIdOf(el) }))
  },
  {
    // Ultimo recurso: nenhuma classe reconhecivel, so' o avatar. Toda linha
    // tem um, e dele sai tambem o id do usuario.
    name: "channel-item-avatar",
    rows: () => [...document.querySelectorAll(CHANNEL_ITEM)].flatMap((item) => [...item.querySelectorAll('img[src*="avatars/"]')].map((img) => ({ el: climbToRow(img, item), channelId: channelIdOf(item) })))
  }
];
function dedupeRows(rows) {
  const out = [];
  for (const row of rows) {
    if (!row.el?.isConnected || row.el === document.body) continue;
    if (out.some((o) => o.el === row.el || o.el.contains(row.el) || row.el.contains(o.el))) {
      continue;
    }
    out.push(row);
  }
  return out;
}
function avatarUserId(row) {
  for (const img of row.querySelectorAll("img[src]")) {
    const id = img.getAttribute("src")?.match(/avatars\/(\d+)\//)?.[1];
    if (id) return id;
  }
  for (const el of row.querySelectorAll("[style*='avatars/']")) {
    const id = (el.style.backgroundImage || "").match(/avatars\/(\d+)\//)?.[1];
    if (id) return id;
  }
  return null;
}
function nameTextsOf(row) {
  const texts = [...row.querySelectorAll('[class*="name"]')].map((el) => el.textContent?.trim() ?? "").filter(Boolean);
  if (texts.length) return texts;
  const whole = row.textContent?.trim();
  return whole ? [whole] : [];
}
function liveUserOf(row) {
  const id = avatarUserId(row);
  if (id) {
    const byId = liveUsers.find((u) => u.id === id);
    if (byId) return byId;
  }
  const texts = nameTextsOf(row);
  return liveUsers.find((u) => u.names.some((n) => texts.includes(n)));
}
var sidebarDiag = { estrategiaEscolhida: null, linhas: 0, selosAtivos: 0, tentativas: [] };
function applySidebarBadges() {
  const tentativas = [];
  let escolhida = null;
  let rows = [];
  for (const strategy of SIDEBAR_STRATEGIES) {
    let found = [];
    try {
      found = dedupeRows(strategy.rows());
    } catch {
      found = [];
    }
    tentativas.push({ estrategia: strategy.name, linhas: found.length });
    if (!escolhida && found.length) {
      escolhida = strategy.name;
      rows = found;
    }
  }
  const claimed = /* @__PURE__ */ new Set();
  for (const row of rows) {
    const user = liveUserOf(row.el);
    if (!user) continue;
    claimed.add(row.el);
    if (row.el.querySelector(".p2ps-live-chip")) continue;
    const chip = buildLiveChip(user, row.channelId);
    chip.classList.add("p2ps-live-chip-side");
    const slot = row.el.querySelector('[class*="content__"]') ?? row.el.querySelector('[class*="name"]')?.parentElement ?? row.el;
    slot.appendChild(chip);
  }
  for (const chip of document.querySelectorAll(".p2ps-live-chip-side")) {
    const owner = [...claimed].find((r) => r.contains(chip));
    if (!owner) {
      chip.remove();
      continue;
    }
    const ours = owner.querySelectorAll(".p2ps-live-chip-side");
    for (let i = 1; i < ours.length; i++) ours[i].remove();
  }
  sidebarDiag = {
    estrategiaEscolhida: escolhida,
    linhas: rows.length,
    selosAtivos: document.querySelectorAll(".p2ps-live-chip-side").length,
    tentativas
  };
}
function removeSidebarBadges() {
  for (const chip of document.querySelectorAll(".p2ps-live-chip-side")) chip.remove();
}
function currentUserId() {
  try {
    return BdApi.Webpack.getModule((m) => !isImpostor(m) && m?.getCurrentUser && m?.getUser)?.getCurrentUser()?.id ?? null;
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
  applySidebarBadges();
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
var BITRATES = [
  { label: "Autom\xE1tico", value: null },
  { label: "20 Mb/s", value: 20 },
  { label: "15 Mb/s", value: 15 },
  { label: "10 Mb/s", value: 10 },
  { label: "6 Mb/s", value: 6 },
  { label: "3 Mb/s", value: 3 }
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
  const repaints = [];
  const addSubmenu = (title, options, selected, apply, format) => {
    const item = document.createElement("div");
    item.className = "p2ps-menu-item p2ps-menu-parent";
    const label = document.createElement("span");
    label.textContent = title;
    const value = document.createElement("span");
    value.className = "p2ps-menu-value";
    const paintValue = () => {
      value.textContent = (format ? format() : options.find((o) => o.value === selected())?.label ?? "\u2014") + "  \u203A";
    };
    paintValue();
    repaints.push(paintValue);
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
  addSubmenu(
    "Bitrate",
    BITRATES,
    () => current.budgetMbps,
    (v) => {
      current.budgetMbps = v;
    },
    () => {
      const escolhido = BITRATES.find((o) => o.value === current.budgetMbps);
      if (current.budgetMbps !== null) return escolhido?.label ?? "\u2014";
      const atual = opts.currentBitrate?.();
      return atual ? `Autom\xE1tico \xB7 ${formatMbps(atual.perPeerBps)}` : "Autom\xE1tico";
    }
  );
  if (opts.currentBitrate) {
    const timer = setInterval(() => {
      if (!menu.isConnected) {
        clearInterval(timer);
        return;
      }
      for (const paint of repaints) paint();
    }, 1e3);
  }
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
                    <button class="p2ps-btn p2ps-btn-secondary" data-act="golive"
                        title="Abre a transmiss\xE3o normal do Discord (atalho: Shift+clique no bot\xE3o)">Usar Go Live do Discord</button>
                    <button class="p2ps-btn p2ps-btn-secondary" data-act="cancel">Cancelar</button>
                    <button class="p2ps-btn" data-act="ok" disabled>Transmitir</button>
                </div>
            </div>`;
    const grid = backdrop.querySelector(".p2ps-grid");
    const okBtn = backdrop.querySelector('[data-act="ok"]');
    const audioCheck = backdrop.querySelector('[data-act="audio"]');
    const audioLabel = backdrop.querySelector('[data-act="audio-label"]');
    const audioAvailable = helperReady();
    audioCheck.disabled = !audioAvailable;
    audioCheck.checked = audioAvailable && BdApi.Data.load("P2PShare", "captureAudio") !== false;
    audioLabel.textContent = audioAvailable ? "Transmitir \xE1udio" : "\xC1udio indispon\xEDvel \u2014 componente ainda n\xE3o instalado";
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
    const goLiveBtn = backdrop.querySelector('[data-act="golive"]');
    if (!hasNativeGoLive()) goLiveBtn.remove();
    goLiveBtn.addEventListener("click", () => {
      settle(null);
      openNativeGoLive();
    });
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
  fetchRecentMessages,
  openDm,
  onMessageCreate,
  onMessageDelete,
  onVoiceChannelChange,
  openRelaySocket,
  getSelectedGuildId,
  getChannelGuildId,
  getGuildVoiceChannelIds,
  isUserInVoiceChannel,
  onNavigationChange,
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
  setLiveUsers
};

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
    this.auto = opts.auto ?? true;
    this.createPeer = opts.createPeer ?? defaultFactory;
  }
  peers = /* @__PURE__ */ new Map();
  createPeer;
  budgetMbps;
  auto;
  onCountChange;
  quality = {};
  /**
   * Banda medida pelo proprio WebRTC, ou null enquanto ninguem mediu.
   *
   * Fica separada do orcamento escolhido para que sair do automatico nao
   * apague a medicao — voltar para o automatico reaproveita o que ja' se
   * sabe da rede, em vez de recomecar do zero.
   */
  measuredMbps = null;
  statsTimer = null;
  /** Avisa a interface quanto esta sendo enviado para cada espectador. */
  onBitrateChange;
  /**
   * Orcamento escolhido na mao, ou automatico quando null.
   *
   * No automatico o valor sai da medicao; sem medicao ainda, do orcamento
   * configurado — melhor um palpite razoavel que travar em nada.
   */
  setBudget(mbps) {
    this.auto = mbps === null;
    if (mbps !== null) this.budgetMbps = mbps;
    this.applyBitrate();
  }
  get autoBudget() {
    return this.auto;
  }
  /** Orcamento em vigor agora, medido ou escolhido. */
  get effectiveBudgetMbps() {
    return this.auto && this.measuredMbps !== null ? this.measuredMbps : this.budgetMbps;
  }
  /**
   * Pergunta a cada conexao quanto ela acha que cabe no cano de saida.
   *
   * `availableOutgoingBitrate` e' a estimativa do proprio WebRTC para o par
   * de candidatos em uso. E' o unico numero honesto sobre a rede: qualquer
   * outro seria chute sobre o plano contratado.
   */
  async sampleBandwidth() {
    const amostras = [];
    for (const pc of this.peers.values()) {
      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.availableOutgoingBitrate) {
            amostras.push(report.availableOutgoingBitrate / 1e6);
          }
        });
      } catch {
      }
    }
    const util = usableBudgetMbps(amostras);
    if (util === null) return;
    this.measuredMbps = smoothBudgetMbps(this.measuredMbps, util);
    if (this.auto) this.applyBitrate();
  }
  startSampling() {
    if (this.statsTimer !== null) return;
    this.statsTimer = setInterval(() => void this.sampleBandwidth(), 3e3);
    this.statsTimer?.unref?.();
  }
  stopSampling() {
    if (this.statsTimer === null) return;
    clearInterval(this.statsTimer);
    this.statsTimer = null;
  }
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
    this.startSampling();
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
    this.stopSampling();
    this.onCountChange?.(0);
  }
  /** Redistribui o orçamento de upload entre todos os viewers atuais. */
  applyBitrate() {
    const budget = this.effectiveBudgetMbps;
    const maxBitrate = computePerPeerBitrate(budget, this.peers.size);
    this.onBitrateChange?.(maxBitrate, budget, this.auto && this.measuredMbps !== null);
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
  pc = null;
  connectTimer = null;
  dropTimer = null;
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
      if (pc.connectionState === "connected") {
        this.clearTimer();
        this.clearDropTimer();
      }
      if (pc.connectionState === "closed") {
        this.fail("a transmiss\xE3o foi encerrada");
      }
      if (pc.connectionState === "disconnected") {
        this.startDropTimer();
      }
      if (pc.connectionState === "failed") {
        this.fail(
          "n\xE3o foi poss\xEDvel abrir a conex\xE3o direta com quem transmite. Costuma ser rede que bloqueia conex\xE3o direta, dos dois lados"
        );
      }
    };
    this.connectTimer = setTimeout(
      () => this.fail(
        "tempo esgotado esperando a conex\xE3o com quem transmite"
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
    this.clearDropTimer();
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
  }
  /**
   * Espera a conexão voltar antes de dar por encerrada.
   *
   * Só desiste se o tempo passar sem reconectar; enquanto isso a janela
   * segue aberta, com a última imagem congelada — que é melhor que fechar
   * tudo e obrigar a pessoa a pedir a transmissão de novo.
   */
  startDropTimer() {
    if (this.dropTimer !== null) return;
    this.dropTimer = setTimeout(() => {
      this.dropTimer = null;
      this.fail("a conex\xE3o caiu e n\xE3o voltou");
    }, PEER_DROP_GRACE_MS);
  }
  clearDropTimer() {
    if (this.dropTimer === null) return;
    clearTimeout(this.dropTimer);
    this.dropTimer = null;
  }
  clearTimer() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }
  fail(reason) {
    this.clearTimer();
    this.clearDropTimer();
    this.onFailed?.(reason);
  }
};

// nostr/schnorr.ts
var P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
var N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
var GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
var GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
var mod = (a, m = P) => {
  const r = a % m;
  return r >= 0n ? r : r + m;
};
function pow(base, exp, m = P) {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = result * base % m;
    base = base * base % m;
    exp >>= 1n;
  }
  return result;
}
var inv = (a) => pow(a, P - 2n);
var INF = [0n, 1n, 0n];
function dbl([x, y, z]) {
  if (z === 0n || y === 0n) return INF;
  const ysq = mod(y * y);
  const s = mod(4n * x * ysq);
  const m = mod(3n * x * x);
  const nx = mod(m * m - 2n * s);
  const ny = mod(m * (s - nx) - 8n * ysq * ysq);
  const nz = mod(2n * y * z);
  return [nx, ny, nz];
}
function add(p, q) {
  if (p[2] === 0n) return q;
  if (q[2] === 0n) return p;
  const [x1, y1, z1] = p;
  const [x2, y2, z2] = q;
  const z1z1 = mod(z1 * z1), z2z2 = mod(z2 * z2);
  const u1 = mod(x1 * z2z2), u2 = mod(x2 * z1z1);
  const s1 = mod(y1 * z2 * z2z2), s2 = mod(y2 * z1 * z1z1);
  if (u1 === u2) return s1 === s2 ? dbl(p) : INF;
  const h = mod(u2 - u1), r = mod(s2 - s1);
  const hh = mod(h * h), hhh = mod(h * hh);
  const v = mod(u1 * hh);
  const nx = mod(r * r - hhh - 2n * v);
  const ny = mod(r * (v - nx) - s1 * hhh);
  const nz = mod(h * z1 * z2);
  return [nx, ny, nz];
}
function mul(k, point) {
  let r = INF;
  let q = point;
  while (k > 0n) {
    if (k & 1n) r = add(r, q);
    q = dbl(q);
    k >>= 1n;
  }
  return r;
}
function affine([x, y, z]) {
  if (z === 0n) return null;
  const zi = inv(z), zi2 = mod(zi * zi);
  return [mod(x * zi2), mod(y * zi2 * zi)];
}
var G = [GX, GY, 1n];
function liftX(x) {
  if (x >= P) return null;
  const c = mod(x * x * x + 7n);
  const y = pow(c, (P + 1n) / 4n);
  if (mod(y * y) !== c) return null;
  return [x, (y & 1n) === 0n ? y : P - y, 1n];
}
function hexToBytes(hex) {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error("hex inv\xE1lido");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
var toBig = (b) => BigInt("0x" + (bytesToHex(b) || "0"));
var to32 = (n) => hexToBytes(n.toString(16).padStart(64, "0"));
function concat(...parts2) {
  const out = new Uint8Array(parts2.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts2) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
async function sha2562(data) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}
var tagCache = /* @__PURE__ */ new Map();
async function taggedHash(tag, ...msgs) {
  let t = tagCache.get(tag);
  if (!t) {
    t = await sha2562(new TextEncoder().encode(tag));
    tagCache.set(tag, t);
  }
  return sha2562(concat(t, t, ...msgs));
}
function generateSecretKey() {
  for (; ; ) {
    const sk = crypto.getRandomValues(new Uint8Array(32));
    const d = toBig(sk);
    if (d > 0n && d < N) return bytesToHex(sk);
  }
}
function getPublicKey(secretHex) {
  const d = toBig(hexToBytes(secretHex));
  if (d <= 0n || d >= N) throw new Error("chave privada fora do intervalo");
  const pt = affine(mul(d, G));
  return bytesToHex(to32(pt[0]));
}
async function sign(msgHex, secretHex, auxHex) {
  const m = hexToBytes(msgHex);
  const d0 = toBig(hexToBytes(secretHex));
  if (d0 <= 0n || d0 >= N) throw new Error("chave privada fora do intervalo");
  const [px, py] = affine(mul(d0, G));
  const d = (py & 1n) === 0n ? d0 : N - d0;
  const aux = auxHex ? hexToBytes(auxHex) : crypto.getRandomValues(new Uint8Array(32));
  const t = to32(d ^ toBig(await taggedHash("BIP0340/aux", aux)));
  const pxb = to32(px);
  const k0 = mod(toBig(await taggedHash("BIP0340/nonce", t, pxb, m)), N);
  if (k0 === 0n) throw new Error("nonce nulo");
  const [rx, ry] = affine(mul(k0, G));
  const k = (ry & 1n) === 0n ? k0 : N - k0;
  const rxb = to32(rx);
  const e = mod(toBig(await taggedHash("BIP0340/challenge", rxb, pxb, m)), N);
  return bytesToHex(concat(rxb, to32(mod(k + e * d, N))));
}
async function verify(sigHex, msgHex, pubHex) {
  try {
    const sig = hexToBytes(sigHex);
    const m = hexToBytes(msgHex);
    const pk = hexToBytes(pubHex);
    if (sig.length !== 64 || pk.length !== 32) return false;
    const P0 = liftX(toBig(pk));
    if (!P0) return false;
    const r = toBig(sig.slice(0, 32));
    const s = toBig(sig.slice(32));
    if (r >= P || s >= N) return false;
    const e = mod(toBig(await taggedHash("BIP0340/challenge", sig.slice(0, 32), pk, m)), N);
    const negP = [P0[0], P - P0[1], 1n];
    const R = affine(add(mul(s, G), mul(e, negP)));
    if (!R) return false;
    return (R[1] & 1n) === 0n && R[0] === r;
  } catch {
    return false;
  }
}

// nostr/event.ts
var P2PSHARE_KIND = 25050;
async function eventId(e) {
  const serial = JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
  return bytesToHex(await sha2562(new TextEncoder().encode(serial)));
}
async function finalizeEvent(template, secretKey) {
  const base = {
    pubkey: getPublicKey(secretKey),
    created_at: template.created_at ?? Math.floor(Date.now() / 1e3),
    kind: template.kind,
    tags: template.tags,
    content: template.content
  };
  const id = await eventId(base);
  return { ...base, id, sig: await sign(id, secretKey) };
}
async function verifyEvent(raw) {
  const e = raw;
  if (!e || typeof e !== "object") return false;
  if (typeof e.id !== "string" || typeof e.pubkey !== "string" || typeof e.sig !== "string") return false;
  if (typeof e.created_at !== "number" || typeof e.kind !== "number") return false;
  if (typeof e.content !== "string" || !Array.isArray(e.tags)) return false;
  if (!e.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))) return false;
  if (await eventId(e) !== e.id) return false;
  return verify(e.sig, e.id, e.pubkey);
}

// nostr/room.ts
var VERSION = "p2pshare-v1";
var enc = new TextEncoder();
var dec = new TextDecoder();
async function roomTopic(channelId) {
  return bytesToHex(await sha2562(enc.encode(`${VERSION}:topic:${channelId}`)));
}
var keyCache = /* @__PURE__ */ new Map();
function roomKey(channelId) {
  let key = keyCache.get(channelId);
  if (!key) {
    key = (async () => {
      const raw = await sha2562(enc.encode(`${VERSION}:key:${channelId}`));
      return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    })();
    keyCache.set(channelId, key);
  }
  return key;
}
function toBase64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function sealRoom(channelId, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await roomKey(channelId),
    enc.encode(JSON.stringify(payload))
  );
  const out = new Uint8Array(12 + data.byteLength);
  out.set(iv);
  out.set(new Uint8Array(data), 12);
  return toBase64(out);
}
async function openRoom(channelId, content) {
  try {
    const bytes = fromBase64(content);
    if (bytes.length < 13) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await roomKey(channelId),
      bytes.slice(12)
    );
    return JSON.parse(dec.decode(plain));
  } catch {
    return null;
  }
}

// discovery.ts
var MAX_TTL_MS = 3e4;
var Discovery = class {
  constructor(pool2, opts) {
    this.pool = pool2;
    this.opts = opts;
    this.secretKey = opts.secretKey ?? generateSecretKey();
    this.pubkey = getPublicKey(this.secretKey);
    this.ttlMs = opts.ttlMs ?? 15e3;
    this.renewMs = opts.renewMs ?? 5e3;
    this.maxSkewMs = opts.maxSkewMs ?? 12e4;
    this.unsubPool = pool2.onEvent((e) => {
      void this.handle(e);
    });
    this.pruneTimer = setInterval(() => this.prune(), 1e3);
  }
  secretKey;
  pubkey;
  ttlMs;
  renewMs;
  maxSkewMs;
  topicToChannel = /* @__PURE__ */ new Map();
  watched = [];
  lives = /* @__PURE__ */ new Map();
  /** Sessão → chave que a anunciou primeiro. Ninguém mais fala por ela. */
  owners = /* @__PURE__ */ new Map();
  /** Minha transmissão no ar, se houver. */
  mine = null;
  liveListeners = /* @__PURE__ */ new Set();
  signalListeners = /* @__PURE__ */ new Set();
  pruneTimer;
  unsubPool;
  now() {
    return this.opts.now?.() ?? Date.now();
  }
  /** Canais cujo aviso quero ver. Sempre inclui o da minha transmissão. */
  async watch(channelIds) {
    const wanted = [.../* @__PURE__ */ new Set([...channelIds, ...this.mine ? [this.mine.channelId] : []])].sort();
    if (wanted.join() === this.watched.join()) return;
    this.watched = wanted;
    const map = /* @__PURE__ */ new Map();
    for (const id of wanted) map.set(await roomTopic(id), id);
    if (wanted.join() !== this.watched.join()) return;
    this.topicToChannel = map;
    this.pool.setTopics([...map.keys()]);
    let changed = false;
    for (const [sid, live] of this.lives) {
      if (!wanted.includes(live.channelId)) {
        this.lives.delete(sid);
        changed = true;
      }
    }
    if (changed) this.emitLive();
  }
  live() {
    return [...this.lives.values()];
  }
  onLive(listener) {
    this.liveListeners.add(listener);
    return () => this.liveListeners.delete(listener);
  }
  onSignal(listener) {
    this.signalListeners.add(listener);
    return () => this.signalListeners.delete(listener);
  }
  /** Começa a anunciar. Devolve a função que para (e avisa o fim). */
  startLive(channelId, sessionId) {
    this.stopLive();
    const announce = () => {
      const me = this.opts.me();
      void this.send(channelId, { v: PROTOCOL_VERSION, t: "live", s: sessionId, u: me.id, n: me.name, ttl: this.ttlMs });
    };
    this.mine = { channelId, sessionId, timer: setInterval(announce, this.renewMs) };
    void this.watch(this.watched);
    announce();
    return () => {
      if (this.mine?.sessionId === sessionId) this.stopLive();
    };
  }
  stopLive() {
    if (!this.mine) return;
    const { channelId, sessionId, timer } = this.mine;
    clearInterval(timer);
    this.mine = null;
    void this.send(channelId, { v: PROTOCOL_VERSION, t: "end", s: sessionId, u: this.opts.me().id });
  }
  async sendSignal(channelId, sessionId, kind, toUserId, sdp) {
    await this.send(channelId, { v: PROTOCOL_VERSION, t: kind, s: sessionId, from: this.opts.me().id, to: toUserId, sdp });
  }
  close() {
    this.stopLive();
    clearInterval(this.pruneTimer);
    this.unsubPool();
    this.liveListeners.clear();
    this.signalListeners.clear();
    this.lives.clear();
  }
  async send(channelId, wire) {
    const event = await finalizeEvent({
      kind: P2PSHARE_KIND,
      tags: [["t", await roomTopic(channelId)]],
      content: await sealRoom(channelId, wire),
      created_at: Math.floor(this.now() / 1e3)
    }, this.secretKey);
    this.pool.publish(event);
  }
  emitLive() {
    const list = this.live();
    for (const l of this.liveListeners) {
      try {
        l(list);
      } catch (err) {
        console.error("[P2PShare] ouvinte de aviso falhou", err);
      }
    }
  }
  prune() {
    const now = this.now();
    let changed = false;
    for (const [sid, live] of this.lives) {
      if (live.expiresAt <= now) {
        this.lives.delete(sid);
        changed = true;
      }
    }
    if (changed) this.emitLive();
  }
  /** Exposto para testes; em produção vem do pool. */
  async handle(event) {
    if (event.pubkey === this.pubkey) return;
    const now = this.now();
    if (Math.abs(event.created_at * 1e3 - now) > this.maxSkewMs) return;
    const topic = event.tags.find((t) => t[0] === "t")?.[1];
    const channelId = topic ? this.topicToChannel.get(topic) : void 0;
    if (!channelId) return;
    const wire = await openRoom(channelId, event.content);
    if (!wire || wire.v !== PROTOCOL_VERSION || typeof wire.s !== "string" || !wire.s) return;
    if (wire.t === "live" || wire.t === "end") {
      if (typeof wire.u !== "string" || !wire.u) return;
      const owner = this.owners.get(wire.s);
      if (owner && owner !== event.pubkey) return;
      this.owners.set(wire.s, event.pubkey);
      if (wire.t === "end") {
        if (this.lives.delete(wire.s)) this.emitLive();
        return;
      }
      const ttl = Math.min(MAX_TTL_MS, Math.max(1e3, Number(wire.ttl) || this.ttlMs));
      const prev = this.lives.get(wire.s);
      this.lives.set(wire.s, {
        channelId,
        sessionId: wire.s,
        userId: wire.u,
        name: typeof wire.n === "string" && wire.n ? wire.n.slice(0, 64) : wire.u,
        pubkey: event.pubkey,
        expiresAt: now + ttl
      });
      if (!prev) this.emitLive();
      return;
    }
    if (wire.t !== "offer" && wire.t !== "answer") return;
    if (wire.to !== this.opts.me().id || typeof wire.from !== "string" || typeof wire.sdp !== "string") return;
    if (wire.t === "offer") {
      if (this.mine?.sessionId !== wire.s || this.mine.channelId !== channelId) return;
    } else {
      if (this.owners.get(wire.s) !== event.pubkey) return;
    }
    const signal = { channelId, sessionId: wire.s, kind: wire.t, fromUserId: wire.from, sdp: wire.sdp };
    for (const l of this.signalListeners) {
      try {
        l(signal);
      } catch (err) {
        console.error("[P2PShare] ouvinte de sinal falhou", err);
      }
    }
  }
};

// nostr/pool.ts
var SUB_ID = "p2ps";
var SEEN_LIMIT = 2e3;
var RelayPool = class {
  constructor(urls, factory, opts) {
    this.factory = factory;
    this.opts = opts;
    this.conns = urls.map((url) => ({ url, socket: null, open: false, retry: 0, timer: null }));
    for (const c of this.conns) this.connect(c);
  }
  conns;
  topics = [];
  seen = /* @__PURE__ */ new Set();
  closed = false;
  listeners = /* @__PURE__ */ new Set();
  get openCount() {
    return this.conns.filter((c) => c.open).length;
  }
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Troca os tópicos escutados. Lista vazia cancela a inscrição. */
  setTopics(topics) {
    const next = [...new Set(topics)].sort();
    if (next.join() === this.topics.join()) return;
    this.topics = next;
    for (const c of this.conns) if (c.open) this.subscribe(c);
  }
  publish(event) {
    this.remember(event.id);
    const frame = JSON.stringify(["EVENT", event]);
    for (const c of this.conns) {
      if (!c.open) continue;
      try {
        c.socket?.send(frame);
      } catch {
      }
    }
  }
  close() {
    this.closed = true;
    for (const c of this.conns) {
      if (c.timer) clearTimeout(c.timer);
      c.timer = null;
      try {
        c.socket?.close();
      } catch {
      }
      c.socket = null;
      c.open = false;
    }
    this.listeners.clear();
  }
  now() {
    return this.opts.now?.() ?? Date.now();
  }
  connect(c) {
    if (this.closed) return;
    let socket;
    try {
      socket = this.factory(c.url);
    } catch {
      this.scheduleReconnect(c);
      return;
    }
    c.socket = socket;
    socket.onopen = () => {
      c.open = true;
      c.retry = 0;
      this.subscribe(c);
    };
    socket.onmessage = (data) => this.handle(data);
    socket.onclose = () => {
      if (c.socket !== socket) return;
      c.open = false;
      c.socket = null;
      this.scheduleReconnect(c);
    };
  }
  scheduleReconnect(c) {
    if (this.closed || c.timer) return;
    const base = this.opts.reconnectBaseMs ?? 2e3;
    const max = this.opts.reconnectMaxMs ?? 6e4;
    const delay = Math.min(max, base * 2 ** c.retry);
    c.retry++;
    c.timer = setTimeout(() => {
      c.timer = null;
      this.connect(c);
    }, delay);
  }
  subscribe(c) {
    try {
      if (!this.topics.length) {
        c.socket?.send(JSON.stringify(["CLOSE", SUB_ID]));
        return;
      }
      const since = Math.floor(this.now() / 1e3) - (this.opts.sinceSeconds ?? 30);
      c.socket?.send(JSON.stringify(["REQ", SUB_ID, { kinds: [this.opts.kind], "#t": this.topics, since }]));
    } catch {
    }
  }
  remember(id) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > SEEN_LIMIT) {
      this.seen.delete(this.seen.values().next().value);
    }
    return true;
  }
  handle(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg) || msg[0] !== "EVENT" || msg[1] !== SUB_ID) return;
    const event = msg[2];
    if (typeof event?.id !== "string" || !this.remember(event.id)) return;
    if (event.kind !== this.opts.kind) return;
    const t = event.tags?.find?.((tag) => tag?.[0] === "t")?.[1];
    if (!t || !this.topics.includes(t)) return;
    void verifyEvent(event).then((ok) => {
      if (!ok) {
        this.seen.delete(event.id);
        return;
      }
      for (const l of this.listeners) {
        try {
          l(event);
        } catch (err) {
          console.error("[P2PShare] ouvinte de relay falhou", err);
        }
      }
    });
  }
};

// signaling.ts
var pool = null;
var discovery = null;
var unwatchNav = null;
function ensure() {
  if (discovery) return discovery;
  pool = new RelayPool(RELAYS, (url) => host.openRelaySocket(url), { kind: P2PSHARE_KIND });
  discovery = new Discovery(pool, {
    me: () => ({ id: host.getCurrentUserId(), name: host.getCurrentUsername() })
  });
  unwatchNav = host.onNavigationChange(() => {
    void refreshWatched();
  });
  void refreshWatched();
  return discovery;
}
async function refreshWatched() {
  if (!discovery) return;
  const ids = /* @__PURE__ */ new Set();
  const voice = host.getVoiceChannelId();
  const guilds = /* @__PURE__ */ new Set();
  const selected = host.getSelectedGuildId();
  if (selected) guilds.add(selected);
  if (voice) {
    ids.add(voice);
    const g = host.getChannelGuildId(voice);
    if (g) guilds.add(g);
  }
  for (const g of guilds) for (const id of host.getGuildVoiceChannelIds(g)) ids.add(id);
  await discovery.watch([...ids]);
}
function stopSignaling() {
  unwatchNav?.();
  unwatchNav = null;
  discovery?.close();
  discovery = null;
  pool?.close();
  pool = null;
}
function announceLive(channelId, sessionId) {
  return ensure().startLive(channelId, sessionId);
}
function sendHandshake(channelId, sessionId, kind, targetUserId, sdp) {
  return ensure().sendSignal(channelId, sessionId, kind, targetUserId, sdp);
}
function toBeacon(live) {
  return {
    messageId: `nostr:${live.sessionId}`,
    channelId: live.channelId,
    sessionId: live.sessionId,
    broadcasterId: live.userId,
    broadcasterName: live.name
  };
}
function believable(live, myId) {
  return live.userId !== myId && host.isUserInVoiceChannel(live.userId, live.channelId);
}
function observeSignals(handlers) {
  const d = ensure();
  const myId = host.getCurrentUserId();
  let shown = /* @__PURE__ */ new Map();
  const sync = () => {
    const next = /* @__PURE__ */ new Map();
    for (const live of d.live()) {
      if (!believable(live, myId)) continue;
      const b = toBeacon(live);
      next.set(b.messageId, b);
    }
    for (const [key, b] of next) if (!shown.has(key)) handlers.onBeacon?.(b);
    for (const [key, b] of shown) if (!next.has(key)) handlers.onBeaconGone?.(b);
    shown = next;
  };
  const unsubLive = d.onLive(sync);
  const unsubNav = host.onNavigationChange(() => setTimeout(sync, 0));
  const unsubSignal = d.onSignal((s) => {
    handlers.onHandshake?.({ sessionId: s.sessionId, kind: s.kind, fromUserId: s.fromUserId, sdp: s.sdp });
  });
  sync();
  return () => {
    unsubLive();
    unsubNav();
    unsubSignal();
  };
}

// broadcast.ts
var DEFAULT_QUALITY = {
  maxHeight: null,
  maxFramerate: null,
  budgetMbps: null
};
var session = null;
var quality = { ...DEFAULT_QUALITY };
var currentBitrate = null;
function getCurrentBitrate() {
  return currentBitrate;
}
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
  session.peers.setBudget(choice.budgetMbps);
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
    // Ate' a medicao existir, o orcamento configurado e' o palpite.
    budgetMbps: quality.budgetMbps ?? host.getBudgetMbps(),
    auto: quality.budgetMbps === null
  });
  peers.onBitrateChange = (perPeerBps, budgetMbps, medido) => {
    currentBitrate = { perPeerBps, budgetMbps, medido };
  };
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
    session?.stopAnnounce();
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
      if (!host.isUserInVoiceChannel(event.fromUserId, channelId)) {
        console.warn("[P2PShare] offer de quem n\xE3o est\xE1 na chamada, ignorado", event.fromUserId);
        return;
      }
      peers.handleOffer(event.fromUserId, event.sdp).catch((err) => console.error("[P2PShare] falha ao responder offer", err));
    }
  });
  const stopAnnounce = announceLive(channelId, sessionId);
  session = {
    sessionId,
    channelId,
    stopAnnounce,
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
  current.stopAnnounce();
  notify();
  host.toast("Transmiss\xE3o encerrada", "info");
}

// host/bd/sounds.ts
var SOUND_STREAM_STARTED = "stream_started";
var SOUND_VIEWER_JOINED = "stream_user_joined";
var SOUND_STREAM_ENDED = "stream_ended";
var PLAY_SOUND_MARKER = "Unable to find sound for pack name";
var MANGLED_KEYS = ["Ak", "Qh", "aN"];
function getModule2(filter, options) {
  return BdApi.Webpack?.getModule?.((m) => !isImpostor(m) && filter(m), options);
}
function safeValues(m) {
  const out = [];
  try {
    for (const key of Object.keys(m)) {
      try {
        out.push(m[key]);
      } catch {
      }
    }
  } catch {
  }
  return out;
}
function isFunction(value) {
  return typeof value === "function";
}
function hasSource(fn, marker) {
  try {
    return isFunction(fn) && Function.prototype.toString.call(fn).includes(marker);
  } catch {
    return false;
  }
}
var STRATEGIES = [
  {
    // Builds em que o export ainda se chama playSound. Barato e exato,
    // então é o primeiro mesmo sendo o menos provável hoje.
    name: "playSound-nomeado",
    resolve() {
      const mod2 = getModule2((m) => isFunction(m?.playSound));
      if (!mod2) return null;
      return (name) => mod2.playSound(name, 1);
    }
  },
  {
    // Mesmo módulo, nome apagado pela minificação: reconhecido pelo aviso
    // que só ele emite.
    name: "playSound-por-corpo",
    resolve() {
      let found = null;
      getModule2((m) => {
        if (typeof m !== "object" || m === null) return false;
        const fn = safeValues(m).find((v) => hasSource(v, PLAY_SOUND_MARKER));
        if (!fn) return false;
        found = fn;
        return true;
      });
      if (!found) return null;
      return (name) => found(name, 1);
    }
  },
  {
    // Os nomes mangleados atuais. Exigir o conjunto exato de três chaves,
    // todas funções, evita casar com qualquer módulo que por acaso tenha um
    // `Ak` — mas o mangle muda a cada build do Discord, daí vir depois das
    // buscas que não dependem dele.
    name: "SoundUtils-mangleado",
    resolve() {
      const mod2 = getModule2((m) => {
        if (typeof m !== "object" || m === null) return false;
        const keys = Object.keys(m);
        return keys.length === MANGLED_KEYS.length && MANGLED_KEYS.every((k) => keys.includes(k)) && MANGLED_KEYS.every((k) => isFunction(m[k]));
      });
      if (!mod2) return null;
      return (name) => mod2.Ak(name, 1);
    }
  }
];
var player = null;
var attempts = 0;
var MAX_ATTEMPTS = 3;
function getPlayer() {
  if (player) return player;
  if (attempts >= MAX_ATTEMPTS) return null;
  attempts++;
  for (const strategy of STRATEGIES) {
    try {
      const found = strategy.resolve();
      if (!found) continue;
      player = found;
      recordDiagnostics2(strategy.name, null);
      return player;
    } catch (err) {
      lastError2 = err?.message ?? String(err);
    }
  }
  recordDiagnostics2(null, lastError2 ?? "nenhuma estrat\xE9gia encontrou o m\xF3dulo de som");
  return null;
}
var lastError2 = null;
function recordDiagnostics2(strategy, error) {
  try {
    const fs = require("fs");
    const path = require("path");
    fs.writeFileSync(
      path.join(BdApi.Plugins.folder, "p2pshare-sounds-debug.json"),
      JSON.stringify({
        quando: (/* @__PURE__ */ new Date()).toISOString(),
        estrategiaQueCasou: strategy,
        tentativas: attempts,
        // Distingue "achei o módulo certo" de "achei algo parecido":
        // hoje o esperado é false, porque o export está mangleado.
        temPlaySoundNomeado: strategy === "playSound-nomeado",
        sons: {
          transmissaoIniciada: SOUND_STREAM_STARTED,
          transmissaoEncerrada: SOUND_STREAM_ENDED,
          espectadorEntrou: SOUND_VIEWER_JOINED
        },
        erro: error
      }, null, 2),
      "utf8"
    );
  } catch {
  }
}
function play(name) {
  try {
    getPlayer()?.(name);
  } catch (err) {
    lastError2 = err?.message ?? String(err);
    player = null;
    console.warn("[P2PShare] n\xE3o deu para tocar o som", err);
  }
}
function playStreamStarted() {
  play(SOUND_STREAM_STARTED);
}
function playViewerJoined() {
  play(SOUND_VIEWER_JOINED);
}
function playStreamStopped() {
  play(SOUND_STREAM_ENDED);
}
function warmSounds() {
  try {
    getPlayer();
  } catch {
  }
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
function parseVersionFile(text) {
  const v = text.trim();
  return /^\d+(\.\d+){0,3}$/.test(v) ? v : null;
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
function beaconIsHere(beacon) {
  const current = host.getVoiceChannelId();
  return current !== null && beacon.channelId === current;
}
async function startWatching(beacon) {
  if (watching.has(beacon.sessionId)) return;
  if (!beaconIsHere(beacon)) {
    host.toast(`Entre na chamada de ${beacon.broadcasterName} para assistir`, "info");
    return;
  }
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
}
function initWatcher() {
  const unsubscribe = observeSignals({
    onBeacon: (beacon) => {
      beacons.set(beacon.messageId, beacon);
      notifyBeacons();
    },
    onBeaconGone: (beacon) => {
      if (!beacons.delete(beacon.messageId)) return;
      stopWatching(beacon.sessionId);
      notifyBeacons();
    },
    onHandshake: (event) => {
      if (event.kind !== "answer") return;
      watching.get(event.sessionId)?.handleAnswer(event.sdp).catch((err) => console.error("[P2PShare] answer inv\xE1lida", err));
    }
  });
  const unsubVoice = host.onVoiceChannelChange((channelId) => {
    for (const b of beacons.values()) {
      if (b.channelId !== channelId && watching.has(b.sessionId)) stopWatching(b.sessionId);
    }
    notifyBeacons();
  });
  return () => {
    unsubscribe();
    unsubVoice();
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
var CHECK_INTERVAL_MS = 10 * 60 * 1e3;
function isBusy() {
  return isBroadcasting() || watchingCount() > 0;
}
async function fetchText(url) {
  try {
    const res = BdApi.Net?.fetch ? await BdApi.Net.fetch(url, { redirect: "follow" }) : await fetch(url, { cache: "no-store" });
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
var retryTimer = null;
function retryLater() {
  if (retryTimer !== null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void checkForUpdate();
  }, RETRY_WHEN_BUSY_MS);
}
async function checkForUpdate() {
  if (!UPDATE_URL) return;
  if (isBusy()) {
    retryLater();
    return;
  }
  if (VERSION_URL) {
    const text = await fetchText(VERSION_URL);
    const published = text ? parseVersionFile(text) : null;
    if (published && !isNewer(published, PLUGIN_VERSION)) return;
  }
  const source = await fetchText(UPDATE_URL);
  if (!source) return;
  if (!looksLikePlugin(source, PLUGIN_NAME)) {
    console.warn("[P2PShare] updater: resposta n\xE3o parece o plugin, ignorando");
    return;
  }
  const remote = parseMetaVersion(source);
  if (!remote || !isNewer(remote, PLUGIN_VERSION)) return;
  if (isBusy()) {
    retryLater();
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
  return () => {
    clearInterval(timer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };
}

// bd-entry.ts
var P2PShare = class {
  cleanupWatcher = null;
  cleanupState = null;
  cleanupUpdater = null;
  cleanupVoiceBtn = null;
  cleanupBeacons = null;
  cleanupVoice = null;
  /** Relógio de espera pelo login; parar o plugin antes disso o cancela. */
  readyTimer = null;
  /**
   * O carregador pode chamar start() antes de o Discord ter o usuário
   * logado. Sem usuário nada funciona (o watcher precisa do próprio id),
   * então espera ele aparecer em vez de explodir.
   */
  start() {
    if (hasCurrentUser()) {
      this.startReady();
      return;
    }
    console.info("[P2PShare] esperando o login do Discord para iniciar");
    this.readyTimer = setInterval(() => {
      if (!hasCurrentUser()) return;
      if (this.readyTimer) clearInterval(this.readyTimer);
      this.readyTimer = null;
      this.startReady();
    }, 500);
  }
  startReady() {
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
        },
        currentBitrate: getCurrentBitrate
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
      onAnchorChange: (found) => ui_exports.setLauncherHidden(found),
      mode: loadSetting("nativeButton", "p2p")
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
            if (beaconIsHere(b)) ui_exports.focusChannel(b.channelId);
            void startWatching(b);
          }
        });
      }
      ui_exports.setLiveUsers(users);
    };
    this.cleanupBeacons = onBeaconsChange(refreshLive);
    this.cleanupVoice = onVoiceChannelChange(() => refreshLive());
    let { viewers, active } = getBroadcastState();
    this.cleanupState = onBroadcastStateChange((state) => {
      ui_exports.updateLauncher(state);
      ui_exports.updateVoiceButton(state);
      refreshLive();
      if (state.active && !active) playStreamStarted();
      if (!state.active && active) playStreamStopped();
      active = state.active;
      if (state.viewers > viewers) playViewerJoined();
      viewers = state.viewers;
    });
    this.cleanupUpdater = startUpdateChecks();
    void syncHelper();
    setTimeout(warmSounds, 5e3);
    setTimeout(() => ui_exports.dumpVoiceDiagnostics(), 8e3);
  }
  stop() {
    if (this.readyTimer) {
      clearInterval(this.readyTimer);
      this.readyTimer = null;
      return;
    }
    void stopBroadcast();
    this.cleanupState?.();
    this.cleanupState = null;
    this.cleanupBeacons?.();
    this.cleanupBeacons = null;
    this.cleanupVoice?.();
    this.cleanupVoice = null;
    this.cleanupVoiceBtn?.();
    this.cleanupVoiceBtn = null;
    this.cleanupUpdater?.();
    this.cleanupUpdater = null;
    this.cleanupWatcher?.();
    this.cleanupWatcher = null;
    setTimeout(stopSignaling, 1500);
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
    const native = document.createElement("label");
    native.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:20px;cursor:pointer";
    const nativeCheck = document.createElement("input");
    nativeCheck.type = "checkbox";
    nativeCheck.checked = loadSetting("nativeButton", "p2p") === "p2p";
    nativeCheck.addEventListener("change", () => {
      const mode = nativeCheck.checked ? "p2p" : "discord";
      saveSetting("nativeButton", mode);
      ui_exports.setNativeButtonMode(mode);
    });
    const nativeText = document.createElement("span");
    nativeText.textContent = 'O bot\xE3o "Compartilhar tela" do Discord transmite via P2P';
    native.append(nativeCheck, nativeText);
    const nativeHint = document.createElement("div");
    nativeHint.textContent = 'Ligado, o bot\xE3o de tela da chamada abre o P2PShare; Shift+clique nele (ou "Usar Go Live do Discord" no seletor) abre a transmiss\xE3o normal do Discord. Desligado, o bot\xE3o volta a ser s\xF3 do Discord e o P2P fica no bot\xE3o flutuante.';
    nativeHint.style.cssText = "font-size:12px;color:var(--text-muted,#72767d);margin-top:4px";
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
      helperStatus.textContent = ready ? "Componente de \xE1udio instalado." : err ? `N\xE3o deu para instalar: ${err}` : "Instalando o componente de \xE1udio\u2026";
      helperStatus.style.color = ready ? "var(--text-positive, #23a55a)" : "var(--text-muted, #72767d)";
      helperBtn.textContent = ready ? "Desinstalar" : "Tentar de novo";
      helperBtn.style.background = ready ? "var(--status-danger, #ed4245)" : "var(--brand-experiment, #5865f2)";
    };
    helperBtn.addEventListener("click", async () => {
      helperBtn.disabled = true;
      if (helperReady()) {
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
      native,
      nativeHint,
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
