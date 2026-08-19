/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    type Beacon,
    beaconContent,
    handshakeBody,
    handshakeMarker,
    parseBeacon,
    parseHandshakeBody
} from "./beacon";
import { formatHandshakeName, type HandshakeKind, parseHandshakeName } from "./codec";
import { HANDSHAKE_TTL_MS } from "./constants";
import { deliverHandshake } from "./handshake";
import { host } from "./host";

export type { Beacon } from "./beacon";

export interface HandshakeEvent {
    sessionId: string;
    kind: HandshakeKind;
    fromUserId: string;
    sdp: string;
}

export function postBeacon(channelId: string, sessionId: string, username: string): Promise<string> {
    return host.sendMessage(channelId, beaconContent(sessionId, username));
}

export function removeBeacon(channelId: string, messageId: string): Promise<void> {
    return host.deleteMessage(channelId, messageId);
}

/**
 * Posta um offer/answer como anexo .txt, roteado pelo nome do arquivo.
 *
 * Vai por DM quando possível: o handshake é entre duas pessoas e nunca
 * precisou ser público. O canal de voz continua como reserva, para quando a
 * DM estiver bloqueada.
 */
export async function sendHandshake(
    channelId: string,
    sessionId: string,
    kind: HandshakeKind,
    targetUserId: string,
    sdp: string
): Promise<void> {
    const via = await deliverHandshake(
        {
            openDm: host.openDm,
            upload: host.uploadTextAttachment
        },
        {
            fallbackChannelId: channelId,
            targetUserId,
            filename: formatHandshakeName({ sessionId, kind, targetUserId }),
            body: handshakeBody(kind, sdp),
            marker: handshakeMarker(sessionId, kind)
        }
    );

    if (via === "channel") {
        console.info("[P2PShare] handshake foi pelo canal: DM indisponível");
    }
}

/**
 * Observa o chat e traduz mensagens em eventos de sinalização.
 *
 * Handshakes endereçados a mim são baixados; o resto é descartado pelo nome do
 * arquivo, sem custo de rede. Handshakes que eu mesmo mandei somem depois do
 * TTL, para não deixar lixo no canal.
 */
export function observeSignals(handlers: {
    onBeacon?: (beacon: Beacon) => void;
    onBeaconGone?: (channelId: string, messageId: string) => void;
    onHandshake?: (event: HandshakeEvent) => void;
}): () => void {
    const myId = host.getCurrentUserId();

    const unsubCreate = host.onMessageCreate(message => {
        const beacon = parseBeacon(message);
        if (beacon) {
            handlers.onBeacon?.(beacon);
            return;
        }

        for (const attachment of message.attachments ?? []) {
            const name = parseHandshakeName(attachment.filename);
            if (!name) continue;

            if (message.author.id === myId) {
                // É meu: some com ele depois que o outro lado teve tempo de baixar.
                setTimeout(() => {
                    host.deleteMessage(message.channel_id, message.id).catch(() => { });
                }, HANDSHAKE_TTL_MS);
                continue;
            }

            if (name.targetUserId !== myId) continue;

            host.fetchAttachmentText(attachment.url)
                .then(text => {
                    const body = parseHandshakeBody(text);
                    if (!body) return;

                    handlers.onHandshake?.({
                        sessionId: name.sessionId,
                        kind: name.kind,
                        fromUserId: message.author.id,
                        sdp: body.sdp
                    });
                })
                .catch(err => console.warn("[P2PShare] handshake ilegível", err));
        }
    });

    const unsubDelete = host.onMessageDelete((channelId, messageId) => {
        handlers.onBeaconGone?.(channelId, messageId);
    });

    return () => {
        unsubCreate();
        unsubDelete();
    };
}
