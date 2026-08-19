/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isBroadcasting } from "../../broadcast";
import { PLUGIN_VERSION, UPDATE_URL } from "../../constants";
import { isNewer, looksLikePlugin, parseMetaVersion } from "../../updater";
import { watchingCount } from "../../watch";
import { loadSetting } from "./settings";

declare const BdApi: any;

const PLUGIN_NAME = "P2PShare";
const FILE_NAME = "P2PShare.plugin.js";

/** Quando ocupado, tenta de novo daqui a pouco em vez de desistir de vez. */
const RETRY_WHEN_BUSY_MS = 5 * 60 * 1000;
/** Checagem periódica, para quem deixa o Discord aberto por dias. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

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

async function fetchLatest(): Promise<string | null> {
    try {
        // Mesmo caminho do componente de áudio: fora da política de conteúdo
        // do Discord, que barra parte dos hosts do GitHub.
        const res = BdApi.Net?.fetch
            ? await BdApi.Net.fetch(UPDATE_URL, { redirect: "follow" })
            : await fetch(UPDATE_URL, { cache: "no-store" });

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

function install(source: string, version: string): boolean {
    try {
        const fs = require("fs");
        const path = require("path");
        const target = path.join(BdApi.Plugins.folder, FILE_NAME);

        fs.writeFileSync(target, source, "utf8");

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
export async function checkForUpdate(): Promise<void> {
    if (!UPDATE_URL) return;

    if (isBusy()) {
        // Nem checa: atualizar agora derrubaria a sessão em andamento.
        setTimeout(() => { void checkForUpdate(); }, RETRY_WHEN_BUSY_MS);
        return;
    }

    const source = await fetchLatest();
    if (!source) return;

    if (!looksLikePlugin(source, PLUGIN_NAME)) {
        console.warn("[P2PShare] updater: resposta não parece o plugin, ignorando");
        return;
    }

    const remote = parseMetaVersion(source);
    if (!remote || !isNewer(remote, PLUGIN_VERSION)) return;

    // Entre baixar e gravar passou um await; a sessão pode ter começado.
    if (isBusy()) {
        setTimeout(() => { void checkForUpdate(); }, RETRY_WHEN_BUSY_MS);
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
    return () => clearInterval(timer);
}
