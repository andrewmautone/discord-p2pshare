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

export interface BeaconScanOptions {
    /** Autor a ignorar. Meu próprio beacon não me interessa como viewer. */
    excludeAuthorId?: string;
    /**
     * messageIds que já passaram por aqui. Sem isso, cada varredura do
     * histórico reanunciaria transmissões que já estão na tela.
     */
    knownMessageIds?: Iterable<string>;
}

/**
 * Filtra beacons de um punhado de mensagens, na ordem em que chegaram.
 *
 * Aceita `unknown` de propósito: a origem é o store do Discord, cujo formato
 * varia entre versões e traz registros meio construídos enquanto o canal
 * carrega. Mensagem que não tem a forma esperada é descartada em silêncio —
 * uma varredura de histórico não pode derrubar a descoberta inteira por causa
 * de um registro estranho.
 */
export function selectBeacons(
    messages: readonly unknown[],
    opts: BeaconScanOptions = {}
): Beacon[] {
    const seen = new Set(opts.knownMessageIds ?? []);
    const found: Beacon[] = [];

    for (const raw of messages) {
        const source = toBeaconSource(raw);
        if (!source || seen.has(source.id)) continue;

        seen.add(source.id);

        const beacon = parseBeacon(source);
        if (!beacon) continue;
        if (beacon.broadcasterId === opts.excludeAuthorId) continue;

        found.push(beacon);
    }

    return found;
}

/** Aceita `channelId` camelCase: o store do Discord usa as duas grafias. */
function toBeaconSource(raw: unknown): BeaconSource | null {
    const m = raw as any;

    const id = m?.id;
    const content = m?.content;
    const authorId = m?.author?.id;
    const channelId = m?.channel_id ?? m?.channelId;

    if (typeof id !== "string") return null;
    if (typeof content !== "string") return null;
    if (typeof authorId !== "string") return null;
    if (typeof channelId !== "string") return null;

    return {
        id,
        channel_id: channelId,
        content,
        // Sem nome nenhum o id cru ainda identifica quem transmite.
        author: { id: authorId, username: m.author.username ?? authorId }
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
