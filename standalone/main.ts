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
import { isAppVersionDir } from "./guards";

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
    registerPreload();
    watchUpdates(resources);
    log("carregador ativo");
}
