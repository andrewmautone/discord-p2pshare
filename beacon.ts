/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { embedPayload, extractPayload, type HandshakeKind } from "./codec";
import { PLUGIN_URL, PROTOCOL_VERSION } from "./constants";

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
 * Texto do beacon. Quem não tem o plugin lê a mensagem normalmente e vê o link
 * de instalação; o sessionId viaja invisível no fim.
 */
export function beaconContent(sessionId: string, username: string): string {
    const visible =
        `🔴 **${username}** está transmitindo a tela via P2P.\n` +
        `Instale o plugin para assistir: ${PLUGIN_URL}`;

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
