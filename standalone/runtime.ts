/*
 * P2PShare — runtime que roda na pagina do Discord (mundo principal).
 *
 * Da ao P2PShare.plugin.js o pedaco do BetterDiscord que ele usa, e nada
 * alem: BdApi (Webpack.getModule, UI.showToast/showNotice, Net.fetch,
 * Data.load/save, DOM.addStyle/removeStyle, Plugins.folder), `require` de
 * fs/path/crypto/electron e um `process` minimo. Tudo que toca disco ou rede
 * passa por P2PShareNative, a ponte restrita do preload.
 *
 * Nao cria `window.BdApi`: o shim so existe dentro do escopo do plugin, para
 * nao enganar outros mods nem o proprio Discord.
 */

import { type GetModuleOptions, searchModules } from "./webpack";

declare const P2PShareNative: any;

const native = P2PShareNative;
const TAG = "[P2PShare]";

/** Console + loader.log (o console da pagina nao fica salvo em lugar nenhum). */
function report(level: "info" | "warn" | "error", ...args: unknown[]): void {
    console[level](TAG, ...args);
    try {
        native.log(`${level}: ${args.map(a => a instanceof Error ? `${a.message} ${a.stack ?? ""}` : String(a)).join(" ")}`);
    } catch {
        // sem log, segue
    }
}

// ---------------------------------------------------------------- webpack

let wreq: any = null;
/** Abaixo disto e um runtime pequeno (o app do Discord tem dezenas de milhares). */
const MIN_MODULES = 1000;

/**
 * Cache de modulos instanciados. No webpack classico e `wreq.c`; no rspack do
 * Discord `c` pode ser outra coisa, entao procura o objeto do wreq cujas
 * chaves sao ids de modulo (as mesmas de `wreq.m`) e cujos valores tem
 * `exports`.
 */
function moduleCache(r: any): Record<string, any> | null {
    if (!r) return null;
    const factories = r.m;
    let best: Record<string, any> | null = null;
    let bestScore = 0;

    const candidates: unknown[] = [r.c];
    try {
        for (const k of Object.keys(r)) candidates.push(r[k]);
    } catch {
        // segue com o que tem
    }

    for (const cand of candidates) {
        if (!cand || typeof cand !== "object" || cand === factories) continue;
        let score = 0;
        try {
            for (const id of Object.keys(cand)) {
                const entry = (cand as any)[id];
                if (entry && typeof entry === "object" && "exports" in entry) score++;
            }
        } catch {
            continue;
        }
        if (score > bestScore) {
            best = cand as Record<string, any>;
            bestScore = score;
        }
    }
    return best;
}

let foundCache: Record<string, any> | null = null;
/** Para diagnostico: quantos runtimes responderam ao push. */
const seenRuntimes = new Set<any>();

/** Cache do app, achado uma vez; antes disso, o melhor palpite do momento. */
function currentCache(): Record<string, any> | null {
    if (foundCache) return foundCache;
    const c = moduleCache(getWreq());
    if (c && Object.keys(c).length >= MIN_MODULES) foundCache = c;
    return c;
}

function moduleCount(r: any): number {
    const c = moduleCache(r);
    return c ? Object.keys(c).length : 0;
}

function chunkGlobals(): string[] {
    return Object.keys(window).filter(k => k.startsWith("webpackChunk"));
}

/**
 * Varios runtimes do rspack dividem o mesmo array de chunks: cada push passa
 * por todos, e o callback e chamado uma vez por runtime. Fica o de maior cache
 * — o do app; os outros sao runtimes auxiliares com uma centena de modulos.
 */
function captureFrom(chunk: any): any {
    if (!chunk?.push) return null;

    let got: any = null;
    const id = Symbol("p2pshare");
    try {
        chunk.push([[id], {}, (r: any) => {
            seenRuntimes.add(r);
            if (moduleCount(r) >= moduleCount(got)) got = r;
        }]);
        // A entrada falsa nao deve ficar na fila do webpack.
        const last = chunk[chunk.length - 1];
        if (last?.[0]?.[0] === id) chunk.pop();
    } catch {
        // so higiene
    }
    return got;
}

/**
 * O require do webpack do app. Capturado na hora do uso, e recapturado
 * enquanto o que temos for pequeno: logo no inicio da pagina o primeiro
 * runtime a atender a fila nao e o do app.
 */
function getWreq(): any {
    if (moduleCount(wreq) >= MIN_MODULES) return wreq;

    let best = wreq;
    for (const name of chunkGlobals()) {
        const r = captureFrom((window as any)[name]);
        if (moduleCount(r) > moduleCount(best)) best = r;
    }
    wreq = best;
    return wreq;
}

function getModule(filter: (m: any) => unknown, options?: GetModuleOptions): any {
    return searchModules(currentCache(), filter, options);
}

// ---------------------------------------------------------------- UI

const PALETTE: Record<string, string> = {
    info: "#5865f2",
    success: "#23a55a",
    warning: "#f0b232",
    warn: "#f0b232",
    error: "#ed4245",
    danger: "#ed4245"
};

function colorOf(type: unknown): string {
    return PALETTE[String(type ?? "info")] ?? PALETTE.info;
}

function layer(id: string, css: string): HTMLElement {
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.style.cssText = css;
        document.body.appendChild(el);
    }
    return el;
}

function showToast(message: string, options: { type?: string; timeout?: number; } = {}): void {
    const host = layer(
        "p2pshare-toasts",
        "position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:100000;" +
        "display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none"
    );

    const toast = document.createElement("div");
    toast.textContent = String(message);
    toast.style.cssText =
        "max-width:480px;padding:10px 14px;border-radius:8px;font:500 14px/1.35 var(--font-primary,sans-serif);" +
        "color:#fff;background:#111214;box-shadow:0 8px 24px rgba(0,0,0,.4);" +
        `border-left:4px solid ${colorOf(options.type)};opacity:0;transition:opacity .2s`;
    host.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = "1"; });

    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 250);
    }, options.timeout ?? 4000);
}

type NoticeButton = { label: string; onClick?: () => void; };

function showNotice(
    content: string | Node,
    options: { type?: string; buttons?: NoticeButton[]; timeout?: number; } = {}
): () => void {
    const host = layer(
        "p2pshare-notices",
        "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:100000;" +
        "display:flex;flex-direction:column;gap:6px;width:min(640px,calc(100vw - 32px))"
    );

    const bar = document.createElement("div");
    bar.style.cssText =
        "display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-radius:8px;" +
        "font:500 14px/1.35 var(--font-primary,sans-serif);color:#fff;" +
        `background:${colorOf(options.type)};box-shadow:0 8px 24px rgba(0,0,0,.35)`;

    const text = document.createElement("div");
    text.style.flex = "1";
    if (typeof content === "string") text.textContent = content;
    else text.appendChild(content);
    bar.appendChild(text);

    const close = () => bar.remove();

    for (const b of options.buttons ?? []) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = b.label;
        btn.style.cssText =
            "padding:4px 12px;border:1px solid rgba(255,255,255,.7);border-radius:4px;background:transparent;" +
            "color:#fff;font:600 13px var(--font-primary,sans-serif);cursor:pointer";
        btn.addEventListener("click", () => {
            try {
                b.onClick?.();
            } catch (err) {
                report("error", err);
            }
        });
        bar.appendChild(btn);
    }

    const x = document.createElement("button");
    x.type = "button";
    x.textContent = "✕";
    x.title = "Fechar";
    x.style.cssText = "border:none;background:transparent;color:#fff;font-size:14px;cursor:pointer;padding:4px";
    x.addEventListener("click", close);
    bar.appendChild(x);

    host.appendChild(bar);
    if (options.timeout) setTimeout(close, options.timeout);
    return close;
}

// ---------------------------------------------------------------- dados

const dataCache = new Map<string, Record<string, unknown>>();

function configFile(name: string): string {
    return native.path.join(native.folder, `${name}.config.json`);
}

function readConfig(name: string): Record<string, unknown> {
    let data = dataCache.get(name);
    if (data) return data;

    data = {};
    try {
        const file = configFile(name);
        if (native.fs.existsSync(file)) data = JSON.parse(native.fs.readFileSync(file, "utf8")) ?? {};
    } catch (err) {
        report("warn", "configuração ilegível, começando do zero", err);
        data = {};
    }
    dataCache.set(name, data!);
    return data!;
}

const Data = {
    load(name: string, key: string): unknown {
        return readConfig(name)[key];
    },
    save(name: string, key: string, value: unknown): void {
        const data = readConfig(name);
        data[key] = value;
        try {
            native.fs.writeFileSync(configFile(name), JSON.stringify(data, null, 4), "utf8");
        } catch (err) {
            report("warn", "não deu para salvar a configuração", err);
        }
    }
};

// ---------------------------------------------------------------- rede

const NULL_BODY = new Set([101, 204, 205, 304]);

async function netFetch(url: string | URL): Promise<Response> {
    const r = await native.fetch(String(url));
    const res = new Response(NULL_BODY.has(r.status) ? null : r.body, {
        status: r.status,
        statusText: r.statusText,
        headers: r.headers
    });
    Object.defineProperty(res, "url", { value: r.url });
    return res;
}

// ---------------------------------------------------------------- DOM

function addStyle(id: string, css: string): void {
    const elId = `p2pshare-style-${id}`;
    let el = document.getElementById(elId);
    if (!el) {
        el = document.createElement("style");
        el.id = elId;
        document.head.appendChild(el);
    }
    el.textContent = css;
}

function removeStyle(id: string): void {
    document.getElementById(`p2pshare-style-${id}`)?.remove();
}

// ---------------------------------------------------------------- BdApi

const BdApi = Object.freeze({
    Webpack: Object.freeze({ getModule }),
    UI: Object.freeze({ showToast, showNotice }),
    Net: Object.freeze({ fetch: netFetch }),
    Data: Object.freeze(Data),
    DOM: Object.freeze({ addStyle, removeStyle }),
    Plugins: Object.freeze({ folder: native.folder })
});

// ---------------------------------------------------------------- require

function createHash(algorithm: string) {
    const parts: (string | Uint8Array)[] = [];
    const hash = {
        update(data: string | ArrayBufferView | ArrayBuffer) {
            if (typeof data === "string") parts.push(data);
            else if (data instanceof ArrayBuffer) parts.push(new Uint8Array(data));
            else parts.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            return hash;
        },
        digest(encoding: "hex" | "base64" = "hex") {
            const enc = new TextEncoder();
            const bytes = parts.map(p => typeof p === "string" ? enc.encode(p) : p);
            const total = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
            let at = 0;
            for (const b of bytes) {
                total.set(b, at);
                at += b.length;
            }
            return native.hash(algorithm, total, encoding);
        }
    };
    return hash;
}

const processShim = Object.freeze({
    pid: native.pid,
    ppid: native.ppid,
    platform: native.platform,
    env: Object.freeze({})
});

const modules: Record<string, unknown> = {
    fs: native.fs,
    path: native.path,
    crypto: Object.freeze({ createHash }),
    electron: Object.freeze({ shell: Object.freeze({ openPath: (p: string) => native.openPath(p) }) }),
    process: processShim
};

function requireShim(name: string): unknown {
    const key = String(name).replace(/^node:/, "");
    if (key in modules) return modules[key];
    throw new Error(`P2PShare: módulo "${name}" não disponível`);
}

// ---------------------------------------------------------------- loader

type Factory = (module: any, exports: any, require: any, bdApi: any, process: any) => void;
type PluginInstance = { start?: () => void; stop?: () => void; getSettingsPanel?: () => Node; };

let instance: PluginInstance | null = null;
let generation = 0;

// ---------------------------------------------------------------- configuracoes

/**
 * No BetterDiscord as configuracoes do plugin ficam no painel do BD. Aqui nao
 * existe esse painel: clique direito no botao do P2PShare abre o mesmo
 * getSettingsPanel() num modal.
 */
function openSettings(): void {
    if (!instance?.getSettingsPanel || document.getElementById("p2pshare-settings")) return;

    const backdrop = document.createElement("div");
    backdrop.id = "p2pshare-settings";
    backdrop.style.cssText =
        "position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.6);" +
        "display:flex;align-items:center;justify-content:center";

    const card = document.createElement("div");
    card.style.cssText =
        "width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 64px);overflow:auto;" +
        "padding:20px;border-radius:10px;background:var(--background-base-low,#2b2d31);" +
        "color:var(--text-normal,#dbdee1);font:14px/1.4 var(--font-primary,sans-serif);" +
        "box-shadow:0 12px 40px rgba(0,0,0,.5)";

    const title = document.createElement("div");
    title.textContent = "P2PShare — configurações";
    title.style.cssText = "font-size:18px;font-weight:700;margin-bottom:16px;color:var(--header-primary,#fff)";

    const foot = document.createElement("div");
    foot.textContent =
        "Para desinstalar: Configurações do Windows > Aplicativos instalados > P2PShare. " +
        "A desinstalação tira o carregador do Discord e apaga a pasta do P2PShare.";
    foot.style.cssText = "margin-top:20px;font-size:12px;color:var(--text-muted,#949ba4)";

    const close = () => {
        backdrop.remove();
        document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            close();
        }
    };

    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "Fechar";
    ok.style.cssText =
        "margin-top:16px;padding:8px 16px;border:none;border-radius:4px;cursor:pointer;" +
        "background:var(--brand-experiment,#5865f2);color:#fff;font-weight:600";
    ok.addEventListener("click", close);

    let panel: Node;
    try {
        panel = instance.getSettingsPanel();
    } catch (err) {
        panel = document.createTextNode(`Não deu para abrir as configurações: ${(err as Error)?.message ?? err}`);
    }

    card.append(title, panel, foot, ok);
    backdrop.appendChild(card);
    backdrop.addEventListener("mousedown", e => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(backdrop);
}

document.addEventListener("contextmenu", e => {
    const target = e.target as Element | null;
    if (!instance || !target?.closest?.(".p2ps-voice-btn, .p2ps-launcher")) return;
    e.preventDefault();
    e.stopPropagation();
    openSettings();
}, true);

function welcomeOnce(): void {
    if (Data.load("P2PShare.loader", "welcomed")) return;
    Data.save("P2PShare.loader", "welcomed", true);
    showNotice(
        "P2PShare ativo. Para transmitir, use o botão de tela do P2PShare no painel de voz. " +
        "Clique direito nele abre as configurações.",
        { type: "success", timeout: 20000 }
    );
}

function discordReady(): boolean {
    try {
        return Boolean(getModule(m => m?.getCurrentUser && m?.getUser)?.getCurrentUser?.());
    } catch {
        return false;
    }
}

function waitForDiscord(): Promise<void> {
    const since = Date.now();
    let warned = false;

    return new Promise(resolve => {
        const check = () => {
            if (document.body && discordReady()) {
                report("info", `Discord pronto em ${Math.round((Date.now() - since) / 1000)} s`);
                resolve();
                return;
            }
            // Uma vez so: mostra onde a espera emperrou (webpack? login?).
            if (!warned && Date.now() - since > 30_000) {
                warned = true;
                const w = getWreq();
                report("warn", "ainda esperando o Discord: " + JSON.stringify({
                    globais: chunkGlobals().map(k => `${k}:${(window as any)[k]?.length}`),
                    wreq: Boolean(w),
                    runtimesVistos: seenRuntimes.size,
                    caches: [...seenRuntimes].map(moduleCount),
                    modulos: moduleCount(w),
                    temM: Boolean(w?.m) ? Object.keys(w.m).length : 0,
                    props: w ? Object.keys(w).map(k => {
                        const v = w[k];
                        const n = v && typeof v === "object" ? Object.keys(v).length : -1;
                        return `${k}:${typeof v}${n >= 0 ? `(${n})` : ""}`;
                    }).join(" ") : "",
                    userStore: Boolean(getModule(m => m?.getCurrentUser && m?.getUser)),
                    path: location.pathname
                }));
            }
            setTimeout(check, 500);
        };
        check();
    });
}

function stopCurrent(): void {
    if (!instance) return;
    try {
        instance.stop?.();
    } catch (err) {
        report("error", "erro ao parar o plugin", err);
    }
    instance = null;
}

async function load(factory: Factory): Promise<void> {
    const mine = ++generation;
    await waitForDiscord();
    if (mine !== generation) return; // outra versao chegou enquanto esperava

    // Quem ja usa BetterDiscord roda o P2PShare por la. Dois carregadores ao
    // mesmo tempo dariam dois botoes, dois beacons e sessoes duplicadas.
    if ((window as any).BdApi) {
        report("info", "BetterDiscord detectado; o carregador próprio fica desligado.");
        return;
    }

    stopCurrent();

    try {
        const module = { exports: {} as any };
        factory(module, module.exports, requireShim, BdApi, processShim);

        const Plugin = module.exports?.default ?? module.exports;
        const plugin = typeof Plugin === "function" ? new Plugin() : Plugin;
        plugin.start?.();
        instance = plugin;
        report("info", "plugin iniciado");
        welcomeOnce();
    } catch (err) {
        report("error", "o plugin falhou ao iniciar", err);
        showToast(`P2PShare não iniciou: ${(err as Error)?.message ?? err}`, { type: "error", timeout: 8000 });
    }
}

Object.defineProperty(window, "P2PShareLoader", {
    value: Object.freeze({ load, stop: stopCurrent }),
    configurable: false,
    enumerable: false,
    writable: false
});
