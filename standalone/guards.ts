/*
 * Regras de seguranca da ponte entre o Discord e o disco/rede.
 *
 * O BetterDiscord entrega `fs` inteiro para a pagina do Discord; qualquer
 * script que rode ali (uma XSS, por exemplo) ganharia o disco todo. Aqui a
 * ponte so enxerga a pasta do P2PShare, so baixa do GitHub do projeto e so
 * executa o componente de audio.
 *
 * Funcoes puras de proposito: sao testadas fora do Electron.
 */

import * as path from "path";

import { looksLikePlugin } from "../updater";

/**
 * Qual código do plugin carregar: o arquivo atual, a última cópia boa, ou
 * nenhum.
 *
 * Um desligamento no meio de uma atualização já deixou o plugin com 0 bytes.
 * Plugin vazio não roda, e com ele não roda o próprio atualizador: sem esta
 * escolha a instalação ficava quebrada até reinstalar. Em qualquer caso o
 * Discord abre; isto só decide se o P2PShare vem junto.
 */
export function choosePluginSource(
    current: string | null,
    lastGood: string | null
): { source: string; from: "current" | "lastGood"; } | null {
    if (current !== null && looksLikePlugin(current, "P2PShare")) return { source: current, from: "current" };
    if (lastGood !== null && looksLikePlugin(lastGood, "P2PShare")) return { source: lastGood, from: "lastGood" };
    return null;
}

/** Hosts de onde o P2PShare baixa atualizacao e o componente de audio. */
export const ALLOWED_HOSTS = [
    "github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com"
];

/**
 * Resolve `target` e devolve o caminho absoluto se ele estiver dentro de
 * `root`; null se escapar (`..`, outro disco, caminho UNC).
 */
export function insideRoot(root: string, target: string, p = path.win32): string | null {
    if (typeof target !== "string" || !target) return null;

    const base = p.resolve(root);
    const full = p.resolve(base, target);
    const rel = p.relative(base, full);

    if (rel === "") return full;
    if (rel.startsWith("..") || p.isAbsolute(rel)) return null;
    return full;
}

/** So https e so os hosts da lista; cada redirecionamento passa por aqui de novo. */
export function allowedUrl(url: string): boolean {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return false;
    }
    return u.protocol === "https:" && ALLOWED_HOSTS.includes(u.hostname.toLowerCase());
}

/** Pasta de versao do Discord (`app-1.0.9266`). */
export function isAppVersionDir(name: string): boolean {
    return /^app-\d+(\.\d+)*$/.test(name);
}

/** discord.com e os canais ptb/canary. */
export function isDiscordHost(hostname: string): boolean {
    return ["discord.com", "ptb.discord.com", "canary.discord.com"].includes(hostname.toLowerCase());
}

/** Paginas do Discord onde o P2PShare roda: a janela principal, nao popouts nem overlay. */
export function isMainDiscordPage(pathname: string): boolean {
    return !pathname.startsWith("/popout") && !pathname.startsWith("/overlay");
}

/**
 * Relays Nostr que a ponte aceita abrir. Lista fechada: a ponte não vira um
 * WebSocket genérico para qualquer script que rode na página do Discord.
 * Tem que bater com RELAYS em constants.ts.
 */
export const RELAY_URLS = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.primal.net",
    "wss://nostr.mom",
    "wss://relay.snort.social",
    "wss://offchain.pub"
];

export function allowedRelay(url: unknown): url is string {
    return typeof url === "string" && RELAY_URLS.includes(url);
}
