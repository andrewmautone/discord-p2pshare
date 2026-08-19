/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Entrega do handshake (offer/answer).
 *
 * O handshake é sempre entre exatamente duas pessoas, então ele não precisa
 * ser público: vai por DM, e o canal de voz fica só com o beacon. Mas DM pode
 * estar bloqueada — nesse caso o canal ainda funciona, e uma transmissão que
 * conecta com o chat um pouco poluído é melhor que uma que não conecta.
 *
 * Sem dependência do Discord aqui de propósito: a decisão de por onde mandar é
 * a parte que dá para errar, e assim ela é testável.
 */

export interface HandshakeSender {
    /** Id do canal de DM com o usuário, ou null se não for possível abrir. */
    openDm(userId: string): Promise<string | null>;
    upload(channelId: string, filename: string, text: string, content: string): Promise<void>;
}

export interface HandshakePayload {
    /** Canal público usado quando a DM não dá. */
    fallbackChannelId: string;
    targetUserId: string;
    filename: string;
    body: string;
    marker: string;
}

export type DeliveredVia = "dm" | "channel";

export async function deliverHandshake(
    sender: HandshakeSender,
    payload: HandshakePayload
): Promise<DeliveredVia> {
    const { fallbackChannelId, targetUserId, filename, body, marker } = payload;

    try {
        const dm = await sender.openDm(targetUserId);
        if (dm) {
            await sender.upload(dm, filename, body, marker);
            return "dm";
        }
    } catch (err) {
        console.warn("[P2PShare] DM indisponível, usando o canal", err);
    }

    // Aqui o erro sobe: se nem o canal aceita, não há como negociar a conexão.
    await sender.upload(fallbackChannelId, filename, body, marker);
    return "channel";
}
