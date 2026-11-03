/*
 * P2PShare — preload da janela do Discord.
 *
 * Registrado como preload de sessao, roda AO LADO do preload do Discord (que
 * segue intacto). Na pagina principal do Discord expoe uma ponte PEQUENA
 * (`P2PShareNative`) e injeta o runtime + o plugin; em qualquer outra pagina
 * (splash, popouts, overlay, sites embutidos) nao faz nada.
 *
 * A ponte nao e o `fs` do Node: so le/escreve dentro de %AppData%\P2PShare,
 * so baixa do GitHub do projeto e so abre o componente de audio. Ver guards.ts.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as https from "https";
import * as path from "path";

import { fileLog } from "./filelog";
import { allowedUrl, insideRoot, isDiscordHost, isMainDiscordPage } from "./guards";

const electron = require("electron") as typeof import("electron");
const { contextBridge, webFrame, shell, ipcRenderer } = electron;

const ROOT = path.join(process.env.APPDATA || "", "P2PShare");
const CORE = path.join(ROOT, "core");
const PLUGIN_FILE = path.join(ROOT, "P2PShare.plugin.js");
const HELPER_FILE = path.join(ROOT, "p2pshare-audio.exe");
const MAX_DOWNLOAD = 64 * 1024 * 1024;
const HASHES = new Set(["sha256", "sha1", "md5"]);

function log(...args: unknown[]): void {
    fileLog("preload", ...args);
}

function guard(target: string): string {
    const full = insideRoot(ROOT, target);
    if (!full) throw new Error(`P2PShare: acesso fora da pasta do P2PShare negado: ${target}`);
    return full;
}

function encodingOf(opt: unknown): BufferEncoding | null {
    if (typeof opt === "string") return opt as BufferEncoding;
    if (opt && typeof opt === "object" && "encoding" in opt) {
        return ((opt as { encoding?: BufferEncoding | null; }).encoding) ?? null;
    }
    return null;
}

type FetchResult = {
    status: number;
    statusText: string;
    url: string;
    headers: Record<string, string>;
    body: Uint8Array;
};

function download(url: string, hops = 0): Promise<FetchResult> {
    return new Promise((resolve, reject) => {
        if (!allowedUrl(url)) {
            reject(new Error(`P2PShare: endereço não permitido: ${url}`));
            return;
        }

        const req = https.get(url, { headers: { "User-Agent": "P2PShare" } }, res => {
            const status = res.statusCode ?? 0;
            const location = res.headers.location;

            if ([301, 302, 303, 307, 308].includes(status) && location) {
                res.resume();
                if (hops >= 5) {
                    reject(new Error("P2PShare: redirecionamentos demais"));
                    return;
                }
                resolve(download(new URL(location, url).href, hops + 1));
                return;
            }

            const chunks: Buffer[] = [];
            let size = 0;
            res.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_DOWNLOAD) {
                    req.destroy(new Error("P2PShare: download grande demais"));
                    return;
                }
                chunks.push(chunk);
            });
            res.on("end", () => {
                const headers: Record<string, string> = {};
                for (const [k, v] of Object.entries(res.headers)) {
                    if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
                }
                resolve({
                    status,
                    statusText: res.statusMessage ?? "",
                    url,
                    headers,
                    body: new Uint8Array(Buffer.concat(chunks))
                });
            });
            res.on("error", reject);
        });

        req.on("error", reject);
        req.setTimeout(60_000, () => req.destroy(new Error("P2PShare: tempo esgotado")));
    });
}

const bridge = {
    folder: ROOT,
    pid: process.pid,
    ppid: process.ppid,
    platform: process.platform,

    fs: {
        existsSync(p: string): boolean {
            const full = insideRoot(ROOT, p);
            return full ? fs.existsSync(full) : false;
        },
        readFileSync(p: string, opt?: unknown): string | Uint8Array {
            const enc = encodingOf(opt);
            const full = guard(p);
            return enc ? fs.readFileSync(full, { encoding: enc }) : new Uint8Array(fs.readFileSync(full));
        },
        writeFileSync(p: string, data: string | Uint8Array, opt?: unknown): void {
            const full = guard(p);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            if (typeof data === "string") fs.writeFileSync(full, data, { encoding: encodingOf(opt) ?? "utf8" });
            else fs.writeFileSync(full, Buffer.from(data));
        },
        unlinkSync(p: string): void {
            fs.unlinkSync(guard(p));
        },
        statSync(p: string) {
            const s = fs.statSync(guard(p));
            return { size: s.size, mtimeMs: s.mtimeMs, file: s.isFile(), directory: s.isDirectory() };
        }
    },

    path: {
        sep: path.sep,
        delimiter: path.delimiter,
        join: (...parts: string[]) => path.join(...parts),
        resolve: (...parts: string[]) => path.resolve(...parts),
        dirname: (p: string) => path.dirname(p),
        basename: (p: string, ext?: string) => path.basename(p, ext),
        extname: (p: string) => path.extname(p),
        normalize: (p: string) => path.normalize(p),
        relative: (a: string, b: string) => path.relative(a, b),
        isAbsolute: (p: string) => path.isAbsolute(p)
    },

    hash(algorithm: string, data: string | Uint8Array, encoding: "hex" | "base64" = "hex"): string {
        const alg = String(algorithm).toLowerCase();
        if (!HASHES.has(alg)) throw new Error(`P2PShare: hash não suportado: ${algorithm}`);
        const h = crypto.createHash(alg);
        h.update(typeof data === "string" ? data : Buffer.from(data));
        return h.digest(encoding === "base64" ? "base64" : "hex");
    },

    /** So o componente de audio, e so da pasta do P2PShare. */
    openPath(p: string): Promise<string> {
        const full = insideRoot(ROOT, p);
        if (!full || full.toLowerCase() !== HELPER_FILE.toLowerCase()) {
            return Promise.resolve("P2PShare: só o componente de áudio pode ser aberto");
        }
        return shell.openPath(full);
    },

    fetch(url: string): Promise<FetchResult> {
        return download(String(url));
    },

    log(message: string): void {
        fileLog("runtime", String(message).slice(0, 2000));
    },

    /**
     * WebSocket para os relays Nostr, aberto no processo principal (a CSP da
     * página bloqueia). O processo principal só aceita os relays da lista.
     */
    relay: {
        open(url: string): Promise<number> {
            return ipcRenderer.invoke("p2pshare:relay-open", String(url));
        },
        send(id: number, data: string): void {
            ipcRenderer.send("p2pshare:relay-send", Number(id), String(data));
        },
        close(id: number): void {
            ipcRenderer.send("p2pshare:relay-close", Number(id));
        },
        onEvent(cb: (id: number, type: string, data?: string) => void): void {
            ipcRenderer.on("p2pshare:relay-event", (_e, id: number, type: string, data?: string) => {
                try {
                    cb(id, type, data);
                } catch { /* erro do plugin não derruba a ponte */ }
            });
        }
    }
};

async function runPlugin(): Promise<void> {
    if (!fs.existsSync(PLUGIN_FILE)) {
        log("P2PShare.plugin.js não encontrado em", ROOT);
        return;
    }

    const source = fs.readFileSync(PLUGIN_FILE, "utf8");
    await webFrame.executeJavaScript(
        "P2PShareLoader.load(function (module, exports, require, BdApi, process) {\n" +
        source +
        "\n});\n//# sourceURL=p2pshare:///P2PShare.plugin.js"
    );
}

/**
 * O auto-update grava o arquivo novo do plugin; aqui ele e recarregado, como
 * o BetterDiscord faz. O stop() do plugin antigo roda antes do start() do novo.
 */
function watchPlugin(): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        fs.watch(ROOT, (_event, name) => {
            if (name !== "P2PShare.plugin.js") return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                log("plugin mudou no disco, recarregando");
                void runPlugin().catch(err => log("falha ao recarregar o plugin", err));
            }, 500);
        });
    } catch (err) {
        log("sem recarga automática do plugin", err);
    }
}

function boot(): void {
    // Preload de sessao roda em todo frame: so a pagina principal do Discord.
    if (!process.isMainFrame || !isDiscordHost(location.hostname) || !isMainDiscordPage(location.pathname)) return;

    contextBridge.exposeInMainWorld("P2PShareNative", bridge);

    const runtime = fs.readFileSync(path.join(CORE, "runtime.js"), "utf8");
    void webFrame.executeJavaScript(runtime + "\n//# sourceURL=p2pshare:///runtime.js")
        .then(() => log("runtime injetado"))
        .then(runPlugin)
        .then(() => log("plugin entregue ao runtime"))
        .then(watchPlugin)
        .catch(err => log("não deu para iniciar o P2PShare", err));
}

try {
    boot();
} catch (err) {
    log("não deu para iniciar o P2PShare", err);
}
