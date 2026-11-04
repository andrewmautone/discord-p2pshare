/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isBroadcasting } from "../../broadcast";
import { PLUGIN_VERSION, SIGNATURE_URL, UPDATE_PUBLIC_KEY, UPDATE_URL, VERSION_URL } from "../../constants";
import { isNewer, parseVersionFile, vetUpdate } from "../../updater";
import { watchingCount } from "../../watch";
import { loadSetting } from "./settings";

declare const BdApi: any;

const PLUGIN_NAME = "P2PShare";
const FILE_NAME = "P2PShare.plugin.js";

/** Quando ocupado, tenta de novo daqui a pouco em vez de desistir de vez. */
const RETRY_WHEN_BUSY_MS = 5 * 60 * 1000;
/**
 * Checagem periódica, para quem deixa o Discord aberto por dias.
 *
 * Frequente de propósito: um conserto chega a todos em minutos. Barato
 * porque cada checagem baixa só o arquivo VERSION (poucos bytes).
 */
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Gravar o arquivo faz o BetterDiscord recarregar o plugin na hora
 * (`watchAddons` → `reloadAddon`), o que executa nosso `stop()` — e isso
 * encerra a transmissão e fecha as janelas de quem está assistindo.
 *
 * Atualizar no meio de uma sessão derrubaria todo mundo sem aviso.
 */
function isBusy(): boolean {
    return isBroadcasting() || watchingCount() > 0;
}

async function fetchText(url: string): Promise<string | null> {
    try {
        // Mesmo caminho do componente de áudio: fora da política de conteúdo
        // do Discord, que barra parte dos hosts do GitHub. No carregador
        // standalone, BdApi.Net.fetch passa pela ponte do processo principal.
        const res = BdApi.Net?.fetch
            ? await BdApi.Net.fetch(url, { redirect: "follow" })
            : await fetch(url, { cache: "no-store" });

        if (!res.ok) {
            console.warn(`[P2PShare] updater: host respondeu ${res.status}`);
            return null;
        }
        return await res.text();
    } catch (err) {
        // Sem internet, host fora do ar: não é erro do usuário, segue calado.
        console.warn("[P2PShare] updater: não deu para checar atualização", err);
        return null;
    }
}

/**
 * Grava o plugin novo sem nunca deixar o arquivo pela metade.
 *
 * Gravar direto por cima já deixou o plugin com 0 bytes num desligamento
 * logo depois de uma atualização — e plugin vazio não roda nem o próprio
 * atualizador. No BetterDiscord: escreve ao lado, força para o disco e troca
 * o nome (atômico no NTFS); o nome temporário não termina em .plugin.js, então
 * o BetterDiscord não tenta carregá-lo. No carregador standalone o `fs` é a
 * ponte, cujo writeFileSync já faz isso (desde a 1.21.3).
 */
function writeSafely(fs: any, target: string, source: string): void {
    const atomic = ["openSync", "writeSync", "fsyncSync", "closeSync", "renameSync"]
        .every(fn => typeof fs[fn] === "function");
    if (!atomic) {
        fs.writeFileSync(target, source, "utf8");
        return;
    }

    const tmp = `${target}.p2ps-tmp`;
    const fd = fs.openSync(tmp, "w");
    try {
        fs.writeSync(fd, source, null, "utf8");
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
}

function install(source: string, version: string): boolean {
    try {
        const fs = require("fs");
        const path = require("path");
        const target = path.join(BdApi.Plugins.folder, FILE_NAME);

        writeSafely(fs, target, source);

        // Atualização automática não pode ser invisível: quem usa tem o
        // direito de saber que o código mudou embaixo dele.
        BdApi.UI.showToast(
            `P2PShare atualizado para ${version}.`,
            { type: "success" }
        );
        return true;
    } catch (err) {
        BdApi.UI.showToast(
            `Não deu para gravar a atualização: ${(err as Error).message}`,
            { type: "error" }
        );
        return false;
    }
}

/** Aviso com botão, para quem prefere decidir a cada versão. */
function offer(source: string, version: string): void {
    const close = BdApi.UI.showNotice(
        `P2PShare ${version} disponível (você tem ${PLUGIN_VERSION}).`,
        {
            type: "info",
            buttons: [{
                label: "Atualizar",
                onClick: () => {
                    // Pode ter começado a transmitir depois que o aviso subiu.
                    if (isBusy()) {
                        BdApi.UI.showToast(
                            "Termine a transmissão antes de atualizar — o plugin " +
                            "recarrega e a sessão cairia.",
                            { type: "warning" }
                        );
                        return;
                    }

                    if (install(source, version)) {
                        try {
                            close();
                        } catch {
                            // o aviso pode já ter sido fechado pelo usuário
                        }
                    }
                }
            }]
        }
    );
}

/**
 * Checa se saiu versão nova e instala, ou oferece, conforme a configuração.
 * Falha em silêncio: quem abriu o Discord quer usar o Discord, não lidar com
 * um erro de updater.
 */
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Transmitindo ou assistindo: tenta de novo daqui a pouco. Um adiamento só
 * por vez — com a checagem a cada 10 min, uma live longa empilharia vários.
 */
function retryLater(): void {
    if (retryTimer !== null) return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        void checkForUpdate();
    }, RETRY_WHEN_BUSY_MS);
}

export async function checkForUpdate(): Promise<void> {
    if (!UPDATE_URL) return;

    if (isBusy()) {
        // Nem checa: atualizar agora derrubaria a sessão em andamento.
        retryLater();
        return;
    }

    // Primeiro só o número publicado; o plugin inteiro só se for mais novo.
    if (VERSION_URL) {
        const text = await fetchText(VERSION_URL);
        const published = text ? parseVersionFile(text) : null;
        if (published && !isNewer(published, PLUGIN_VERSION)) return;
        // Sem VERSION legível (ainda não publicado, host fora): cai no
        // caminho antigo, baixando o plugin para ler o @version.
    }

    const source = await fetchText(UPDATE_URL);
    if (!source) return;

    const signature = await fetchText(SIGNATURE_URL);

    const remote = await vetUpdate({
        source,
        signature,
        publicKey: UPDATE_PUBLIC_KEY,
        pluginName: PLUGIN_NAME,
        currentVersion: PLUGIN_VERSION
    });
    if (!remote) {
        console.warn("[P2PShare] updater: atualização recusada (não é mais nova, não parece o plugin ou a assinatura não confere)");
        return;
    }

    // Entre baixar e gravar passou um await; a sessão pode ter começado.
    if (isBusy()) {
        retryLater();
        return;
    }

    if (loadSetting("autoUpdate", true)) install(source, remote);
    else offer(source, remote);
}

/**
 * Liga a checagem periódica. Devolve a função de limpeza.
 * Sem isto, quem deixa o Discord aberto por dias nunca receberia atualização.
 */
export function startUpdateChecks(): () => void {
    void checkForUpdate();

    const timer = setInterval(() => { void checkForUpdate(); }, CHECK_INTERVAL_MS);
    return () => {
        clearInterval(timer);
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = null;
    };
}
