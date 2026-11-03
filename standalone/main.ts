/*
 * P2PShare — parte que roda no processo principal do Discord.
 *
 * Chamado pelo carregador em resources\app\index.js antes do Discord subir.
 * Faz duas coisas, e so:
 *
 *  1. Troca o preload da janela principal pelo nosso. O nosso carrega primeiro
 *     o preload original do Discord, inteiro, e depois o P2PShare.
 *  2. Quando o Discord se atualiza, ele cria uma pasta app-x.y.z nova sem o
 *     carregador. Copiamos o carregador para la antes do reinicio, para o
 *     P2PShare nao sumir a cada atualizacao. Sem tarefa agendada nem processo
 *     extra: so enquanto o proprio Discord esta aberto.
 *
 * Nao mexe em cabecalho HTTP nem em CSP: o Discord ja usa onHeadersReceived,
 * e o Electron aceita um ouvinte so — registrar outro apagaria o deles.
 */

import * as path from "path";

import { isAppVersionDir } from "./guards";

const electron = require("electron") as typeof import("electron");
// fs sem o suporte a asar do Electron: aqui .asar e arquivo, nao pasta.
const fs = require("original-fs") as typeof import("fs");

const LOADER_MARKER = "p2pshareLoader";

const CORE_DIR = __dirname;
const PRELOAD = path.join(CORE_DIR, "preload.js");
const DISCORD_PRELOAD_NAME = "mainScreenPreload.js";

let originalPreload: string | null = null;

function log(...args: unknown[]): void {
    console.log("[P2PShare]", ...args);
}

/** Subclasse que so desvia o preload da janela principal do Discord. */
function patchBrowserWindow(): void {
    const Base = electron.BrowserWindow;

    class BrowserWindow extends Base {
        constructor(options?: Electron.BrowserWindowConstructorOptions) {
            const prefs = options?.webPreferences;
            if (prefs?.preload && path.basename(prefs.preload) === DISCORD_PRELOAD_NAME) {
                originalPreload = prefs.preload;
                prefs.preload = PRELOAD;
            }
            super(options);
        }
    }

    Object.assign(BrowserWindow, Base);
    Object.defineProperty(BrowserWindow, "name", { value: "BrowserWindow", configurable: true });

    // O Discord pega o BrowserWindow do modulo "electron". Trocar a entrada no
    // cache faz todo require posterior receber a subclasse.
    const id = require.resolve("electron");
    const cached = require.cache[id];
    if (!cached) throw new Error("modulo electron fora do cache");
    cached.exports = { ...electron, BrowserWindow };
}

function registerIpc(): void {
    electron.ipcMain.on("p2pshare:original-preload", event => {
        event.returnValue = originalPreload;
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

            fs.renameSync(asar, orig);
            try {
                fs.copyFileSync(stub, asar);
            } catch (err) {
                fs.renameSync(orig, asar); // desfaz: Discord intacto
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

export function init({ resources }: { resources: string; }): void {
    patchBrowserWindow();
    registerIpc();
    watchUpdates(resources);
    log("carregador ativo");
}
