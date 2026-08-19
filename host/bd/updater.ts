/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PLUGIN_VERSION, UPDATE_URL } from "../../constants";
import { isNewer, looksLikePlugin, parseMetaVersion } from "../../updater";

declare const BdApi: any;

const PLUGIN_NAME = "P2PShare";
const FILE_NAME = "P2PShare.plugin.js";

/**
 * Atualização automática sem servidor próprio.
 *
 * O updater embutido do BetterDiscord só atualiza addons da loja oficial deles
 * (ele resolve um id numérico via betterdiscord.app), então plugin
 * auto-hospedado precisa se virar. Aqui buscamos o arquivo publicado, comparamos
 * o `@version` do cabeçalho e — com autorização do usuário — gravamos por cima.
 * O BetterDiscord recarrega o plugin sozinho ao ver o arquivo mudar.
 *
 * Nunca sobrescreve sem perguntar: instalar código novo é decisão de quem usa,
 * não do plugin.
 */

async function fetchLatest(): Promise<string | null> {
    try {
        const res = await fetch(UPDATE_URL, { cache: "no-store" });
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

function install(source: string, version: string): void {
    try {
        const fs = require("fs");
        const path = require("path");
        const target = path.join(BdApi.Plugins.folder, FILE_NAME);

        fs.writeFileSync(target, source, "utf8");

        BdApi.UI.showToast(
            `P2PShare atualizado para ${version}. Recarregando…`,
            { type: "success" }
        );
    } catch (err) {
        BdApi.UI.showToast(
            `Não deu para gravar a atualização: ${(err as Error).message}`,
            { type: "error" }
        );
    }
}

/**
 * Checa se saiu versão nova e, se saiu, oferece instalar.
 * Falha em silêncio: quem abriu o Discord quer usar o Discord, não lidar com
 * um erro de updater.
 */
export async function checkForUpdate(): Promise<void> {
    if (!UPDATE_URL) return;

    const source = await fetchLatest();
    if (!source) return;

    if (!looksLikePlugin(source, PLUGIN_NAME)) {
        console.warn("[P2PShare] updater: resposta não parece o plugin, ignorando");
        return;
    }

    const remote = parseMetaVersion(source);
    if (!remote || !isNewer(remote, PLUGIN_VERSION)) return;

    const close = BdApi.UI.showNotice(
        `P2PShare ${remote} disponível (você tem ${PLUGIN_VERSION}).`,
        {
            type: "info",
            buttons: [{
                label: "Atualizar",
                onClick: () => {
                    install(source, remote);
                    try {
                        close();
                    } catch {
                        // o aviso pode já ter sido fechado pelo usuário
                    }
                }
            }]
        }
    );
}
