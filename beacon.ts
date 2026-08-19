/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { embedPayload, extractPayload, type HandshakeKind } from "./codec";
import { DOWNLOAD_URL, PROTOCOL_VERSION } from "./constants";

/**
 * Formato de fio do beacon e do handshake. Módulo puro de propósito: nada aqui
 * toca no Discord, então tudo é testável sem browser.
 */

interface BeaconPayload {
    v: number;
    s: string;
    /** Presente só em marcador de handshake — serve para distinguir os dois. */
    k?: HandshakeKind;
}

/** O mínimo de uma mensagem do Discord que este módulo precisa enxergar. */
export interface BeaconSource {
    id: string;
    channel_id: string;
    content: string;
    author: { id: string; username: string; };
}

export interface Beacon {
    messageId: string;
    channelId: string;
    sessionId: string;
    broadcasterId: string;
    broadcasterName: string;
}

/**
 * Texto do beacon.
 *
 * Fala com dois públicos ao mesmo tempo: quem já tem o plugin precisa saber
 * onde clicar, e quem não tem precisa de um caminho curto até o instalador —
 * um link para a página do projeto obriga a pessoa a caçar o download.
 *
 * O sessionId viaja invisível no fim.
 */
export function beaconContent(sessionId: string, username: string): string {
    const visible =
        `# 🔴 ${username} está transmitindo a tela\n` +
        "**Já tem o P2PShare?** Clique em **AO VIVO** no quadro dele na chamada " +
        "e a tela abre por cima do avatar.\n" +
        `**Ainda não tem?** [Baixar o instalador](${DOWNLOAD_URL})\n` +
        "-# Vídeo ponto-a-ponto, direto entre os computadores. " +
        "Não passa por servidor nenhum.";

    return embedPayload(visible, { v: PROTOCOL_VERSION, s: sessionId } satisfies BeaconPayload);
}

export function parseBeacon(message: BeaconSource): Beacon | null {
    const payload = extractPayload<BeaconPayload>(message.content);
    if (!payload || payload.v !== PROTOCOL_VERSION) return null;
    if (typeof payload.s !== "string") return null;
    // Handshake também carrega payload invisível, mas com o campo `k`.
    if (payload.k !== undefined) return null;

    return {
        messageId: message.id,
        channelId: message.channel_id,
        sessionId: payload.s,
        broadcasterId: message.author.id,
        broadcasterName: message.author.username
    };
}

/**
 * Corpo da mensagem de handshake: só o marcador invisível, para o plugin
 * reconhecer a mensagem sem precisar baixar o anexo.
 */
export function handshakeMarker(sessionId: string, kind: HandshakeKind): string {
    return embedPayload("", { v: PROTOCOL_VERSION, s: sessionId, k: kind } satisfies BeaconPayload);
}

/** Conteúdo do anexo .txt. JSON puro, sem compressão — cabe e é debugável. */
export function handshakeBody(kind: HandshakeKind, sdp: string): string {
    return JSON.stringify({ v: PROTOCOL_VERSION, type: kind, sdp });
}

export function parseHandshakeBody(text: string): { kind: HandshakeKind; sdp: string; } | null {
    let body: any;
    try {
        body = JSON.parse(text);
    } catch {
        return null;
    }

    if (body?.v !== PROTOCOL_VERSION) return null;
    if (body.type !== "offer" && body.type !== "answer") return null;
    if (typeof body.sdp !== "string") return null;

    return { kind: body.type, sdp: body.sdp };
}
