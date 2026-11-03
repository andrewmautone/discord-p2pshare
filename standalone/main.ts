/*
 * P2PShare — parte que roda no processo principal do Discord.
 *
 * Chamado pelo gancho (app.asar) antes do Discord subir. Faz duas coisas, e so:
 *
 *  1. Registra o preload do P2PShare na sessao do Discord, ao lado dos
 *     preloads dele — o mesmo mecanismo que o proprio Discord usa para o
 *     Sentry. Nada do Discord e substituido.
 *  2. Quando o Discord se atualiza, ele cria uma pasta app-x.y.z nova sem o
 *     gancho. Colocamos o gancho la na abertura e no fechamento, para o
 *     P2PShare nao sumir a cada atualizacao. Sem tarefa agendada nem processo
 *     extra: so enquanto o proprio Discord esta aberto.
 *
 * Nao mexe em cabecalho HTTP nem em CSP: o Discord ja usa onHeadersReceived,
 * e o Electron aceita um ouvinte so — registrar outro apagaria o deles.
 *
 * (Trocar o BrowserWindow via require.cache, como o Vencord fazia, nao pega no
 * Electron 42: ele entrega "electron" sem passar pelo cache.)
 */

import * as path from "path";

import { fileLog } from "./filelog";
import { allowedRelay, isAppVersionDir, isDiscordHost } from "./guards";

const electron = require("electron") as typeof import("electron");
// fs sem o suporte a asar do Electron: aqui .asar e arquivo, nao pasta.
const fs = require("original-fs") as typeof import("fs");

const LOADER_MARKER = "p2pshareLoader";

const CORE_DIR = __dirname;
const PRELOAD = path.join(CORE_DIR, "preload.js");

function log(...args: unknown[]): void {
    fileLog("main", ...args);
}

function registerPreload(): void {
    void electron.app.whenReady().then(() => {
        try {
            const s = electron.session.defaultSession as any;
            if (typeof s.registerPreloadScript === "function") {
                s.registerPreloadScript({ type: "frame", id: "p2pshare", filePath: PRELOAD });
            } else {
                s.setPreloads([...s.getPreloads(), PRELOAD]);
            }
            log("preload registrado na sessão do Discord");
        } catch (err) {
            log("não deu para registrar o preload", err);
        }
    });
}

function isOurAsar(file: string): boolean {
    try {
        // O gancho tem poucos KB; o app.asar do Discord, megabytes.
        if (fs.statSync(file).size > 64 * 1024) return false;
        return fs.readFileSync(file, "latin1").includes(LOADER_MARKER);
    } catch {
        return false;
    }
}

/**
 * Coloca o gancho em toda pasta app-* do Discord que ainda nao tem.
 * Para se o P2PShare tiver sido desinstalado com o Discord aberto: nesse
 * caso nao recolocamos nada.
 */
function reinject(resources: string): void {
    try {
        const stub = path.join(CORE_DIR, "app.asar");
        if (!fs.existsSync(path.join(CORE_DIR, "main.js")) || !fs.existsSync(stub)) return;

        const channelDir = path.resolve(resources, "..", "..");
        for (const name of fs.readdirSync(channelDir)) {
            if (!isAppVersionDir(name)) continue;

            const res = path.join(channelDir, name, "resources");
            const asar = path.join(res, "app.asar");
            const orig = path.join(res, "app.orig.asar");

            if (!fs.existsSync(asar) || fs.existsSync(orig) || isOurAsar(asar)) continue;
            // _app.asar e do Vencord: nao empilhamos carregador em cima de outro.
            if (fs.existsSync(path.join(res, "_app.asar"))) continue;

            // O gancho vai primeiro para um temporario ao lado; so depois as duas
            // trocas de nome, que sao instantaneas. Um desligamento no meio da
            // copia deixa o Discord intacto, nunca sem app.asar ou com um vazio.
            const tmp = path.join(res, "app.p2ps-tmp");
            fs.copyFileSync(stub, tmp);
            const fd = fs.openSync(tmp, "r+");
            try {
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }

            fs.renameSync(asar, orig);
            try {
                fs.renameSync(tmp, asar);
            } catch (err) {
                fs.renameSync(orig, asar); // desfaz: Discord intacto
                try { fs.unlinkSync(tmp); } catch { /* sobra inofensiva */ }
                throw err;
            }
            log(`gancho colocado na versao nova do Discord: ${name}`);
        }
    } catch (err) {
        log("nao deu para preparar a versao nova do Discord", err);
    }
}

function watchUpdates(resources: string): void {
    const run = () => reinject(resources);

    // Na abertura: pega versao que o Discord baixou na sessao anterior.
    setTimeout(run, 15_000);

    // No fim: o reinicio de atualizacao passa por aqui, com a versao nova ja
    // extraida. Nao usamos fs.watch de proposito: ele dispararia com o
    // app.asar novo ainda pela metade.
    electron.app.on("before-quit", run);
}

/**
 * Conexões com os relays Nostr, a pedido da página do Discord.
 *
 * A CSP da página só deixa abrir WebSocket para domínios do Discord, então o
 * socket mora aqui e os dados passam por IPC. Só os relays da lista, só para
 * a página principal do Discord, e com teto de conexões e de tamanho.
 */
const MAX_SOCKETS = 16;
const MAX_FRAME = 256 * 1024;

function relayBridge(): void {
    const { ipcMain } = electron;
    let next = 0;
    const sockets = new Map<number, { ws: WebSocket; owner: Electron.WebContents; }>();
    const watched = new Set<Electron.WebContents>();

    const fromDiscord = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => {
        try {
            return isDiscordHost(new URL(e.senderFrame?.url ?? "").hostname);
        } catch {
            return false;
        }
    };

    const emit = (owner: Electron.WebContents, id: number, type: string, data?: string) => {
        if (!owner.isDestroyed()) owner.send("p2pshare:relay-event", id, type, data);
    };

    const drop = (id: number) => {
        const s = sockets.get(id);
        if (!s) return;
        sockets.delete(id);
        try {
            s.ws.close();
        } catch { /* já fechado */ }
    };

    ipcMain.handle("p2pshare:relay-open", (e, url: unknown) => {
        if (!fromDiscord(e)) throw new Error("origem não permitida");
        if (!allowedRelay(url)) throw new Error("relay não permitido");
        const mine = [...sockets.values()].filter(s => s.owner === e.sender).length;
        if (mine >= MAX_SOCKETS) throw new Error("conexões demais");

        const id = ++next;
        const owner = e.sender;
        const ws = new WebSocket(url);
        sockets.set(id, { ws, owner });

        ws.onopen = () => emit(owner, id, "open");
        ws.onmessage = m => {
            const data = String(m.data);
            if (data.length <= MAX_FRAME) emit(owner, id, "message", data);
        };
        ws.onclose = () => {
            if (sockets.delete(id)) emit(owner, id, "close");
        };
        ws.onerror = () => { /* onclose vem em seguida */ };

        // Página recarregada ou fechada: nada de socket órfão. Um ouvinte por página.
        if (!watched.has(owner)) {
            watched.add(owner);
            owner.once("destroyed", () => {
                watched.delete(owner);
                for (const [sid, s] of sockets) if (s.owner === owner) drop(sid);
            });
        }
        return id;
    });

    ipcMain.on("p2pshare:relay-send", (e, id: unknown, data: unknown) => {
        const s = typeof id === "number" ? sockets.get(id) : undefined;
        if (!s || s.owner !== e.sender || typeof data !== "string" || data.length > MAX_FRAME) return;
        if (s.ws.readyState === WebSocket.OPEN) s.ws.send(data);
    });

    ipcMain.on("p2pshare:relay-close", (e, id: unknown) => {
        const s = typeof id === "number" ? sockets.get(id) : undefined;
        if (s && s.owner === e.sender) drop(id as number);
    });
}

export function init({ resources }: { resources: string; }): void {
    registerPreload();
    try {
        relayBridge();
    } catch (err) {
        log("ponte dos relays indisponível", err);
    }
    watchUpdates(resources);
    log("carregador ativo");
}
