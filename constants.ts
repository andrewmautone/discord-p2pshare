/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const PROTOCOL_VERSION = 1;

export const PLUGIN_URL = "https://github.com/andrewmautone/discord-p2pshare";

/** Versão publicada. O build do BetterDiscord escreve isto no cabeçalho. */
export const PLUGIN_VERSION = "1.13.0";

/** Link direto do instalador na release mais recente. */
export const DOWNLOAD_URL =
    "https://github.com/andrewmautone/discord-p2pshare/releases/latest/download/P2PShare-Setup.exe";

/**
 * Onde o plugin procura por versões novas.
 *
 * Aponta para o arquivo cru publicado — um raw do GitHub ou de um Gist serve.
 * String vazia desliga a checagem por completo.
 */
/**
 * Executável auxiliar que captura o áudio do sistema sem o Discord.
 *
 * Preso à versão deste plugin, e não a `latest`: o binário é conferido contra
 * o hash abaixo, e apontar para a release mais recente faria um plugin antigo
 * baixar um arquivo que ele mesmo recusaria.
 */
export const HELPER_URL =
    `https://github.com/andrewmautone/discord-p2pshare/releases/download/v${PLUGIN_VERSION}/p2pshare-audio.exe`;

/**
 * SHA-256 do auxiliar publicado.
 *
 * O build substitui este marcador pelo hash real do binário. Sem conferência
 * o plugin estaria baixando e executando qualquer coisa que o servidor mande.
 */
export const HELPER_SHA256 = "__HELPER_SHA256__";

export const UPDATE_URL =
    "https://raw.githubusercontent.com/andrewmautone/discord-p2pshare/main/release/P2PShare.plugin.js";

export const ICE_SERVERS: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
];

/**
 * Alfabeto zero-width: 4 code points invisíveis, 2 bits por caractere.
 * ZWSP, ZWNJ, ZWJ e WORD JOINER.
 *
 * Declarados por code point de propósito — literais colados aqui seriam
 * invisíveis no editor e impossíveis de revisar num diff.
 */
export const ZW_CODEPOINTS = [0x200b, 0x200c, 0x200d, 0x2060] as const;
export const ZW_DIGITS: readonly string[] = ZW_CODEPOINTS.map(c => String.fromCodePoint(c));

/** INVISIBLE TIMES — delimita o payload dentro do texto visível. */
export const ZW_DELIM = String.fromCodePoint(0x2062);

export const MIN_BITRATE = 800_000;
export const MAX_BITRATE = 8_000_000;
export const DEFAULT_BUDGET_MBPS = 15;

export const ICE_GATHER_TIMEOUT_MS = 4_000;
export const PEER_CONNECT_TIMEOUT_MS = 30_000;
export const HANDSHAKE_TTL_MS = 20_000;
