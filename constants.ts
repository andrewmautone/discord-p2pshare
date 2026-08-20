/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const PROTOCOL_VERSION = 1;

export const PLUGIN_URL = "https://github.com/andrewmautone/discord-p2pshare";

/** Versão publicada. O build do BetterDiscord escreve isto no cabeçalho. */
export const PLUGIN_VERSION = "1.20.0";

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
 * Publicado numa tag própria, que não acompanha a versão do plugin.
 *
 * Acompanhar acabava em 404 garantido: o plugin chega na máquina de quem usa
 * assim que é gerado, e a release correspondente só existe minutos depois —
 * nesse intervalo a URL aponta para uma tag inexistente e o componente não
 * instala. E não havia o que ganhar com isso: o binário saiu byte a byte
 * idêntico em todas as releases até aqui, porque o código Rust não mudou.
 *
 * Também não serve `latest`, que muda a cada release do plugin: um plugin
 * antigo baixaria um binário novo e o recusaria no confronto de hash.
 *
 * Ao mudar o binário, publique uma tag nova aqui junto com o HELPER_SHA256
 * novo. O confronto de hash abaixo é o que garante que os dois combinam.
 */
export const HELPER_TAG = "audio-v2";

export const HELPER_URL =
    `https://github.com/andrewmautone/discord-p2pshare/releases/download/${HELPER_TAG}/p2pshare-audio.exe`;

/**
 * SHA-256 do auxiliar publicado.
 *
 * O build substitui este marcador pelo hash real do binário. Sem conferência
 * o plugin estaria baixando e executando qualquer coisa que o servidor mande.
 */
export const HELPER_SHA256 = "__HELPER_SHA256__";

export const UPDATE_URL =
    "https://raw.githubusercontent.com/andrewmautone/discord-p2pshare/main/release/P2PShare.plugin.js";

/**
 * Servidores STUN, escolhidos por redundância de operador.
 *
 * Dois não bastavam: rede que bloqueia um provedor costuma bloquear todos os
 * hosts dele, e sem candidato `srflx` o SDP sai só com endereços de rede
 * local — inúteis fora dela. Operadores diferentes tornam o bloqueio total
 * bem menos provável.
 *
 * O último atende em UDP/80 de propósito: onde o 3478 está filtrado, a porta
 * de HTTP costuma passar.
 *
 * Todos verificados respondendo de rede residencial brasileira. Ficaram de
 * fora stun.miwifi.com e stun.qq.com, que não responderam.
 */
export const ICE_SERVERS: RTCIceServer[] = [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.nextcloud.com:3478" },
    { urls: "stun:stun.relay.metered.ca:80" }
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

/**
 * Quanto esperar uma conexão caída voltar antes de dar por encerrada.
 *
 * `disconnected` no WebRTC é quase sempre passageiro: o próprio ICE refaz o
 * caminho em poucos segundos. Desistir na hora encerrava transmissão que ia
 * voltar sozinha; esperar demais deixa a pessoa olhando imagem congelada sem
 * saber que acabou.
 */
export const PEER_DROP_GRACE_MS = 12_000;
export const HANDSHAKE_TTL_MS = 20_000;
