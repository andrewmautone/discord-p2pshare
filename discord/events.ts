/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FluxDispatcher } from "@webpack/common";

import type { DiscordMessage } from "./api";

/** Assina MESSAGE_CREATE. Devolve a função de cancelamento. */
export function onMessageCreate(handler: (message: DiscordMessage) => void): () => void {
    const listener = (event: { message: DiscordMessage; }) => {
        try {
            handler(event.message);
        } catch (err) {
            console.error("[P2PShare] handler de MESSAGE_CREATE falhou", err);
        }
    };

    FluxDispatcher.subscribe("MESSAGE_CREATE", listener);
    return () => FluxDispatcher.unsubscribe("MESSAGE_CREATE", listener);
}


/**
 * Entrada, saída e troca de canal de voz.
 * O Discord dispara VOICE_CHANNEL_SELECT com channelId null ao desconectar.
 */
export function onVoiceChannelChange(
    handler: (channelId: string | null) => void
): () => void {
    const listener = (event: { channelId?: string | null; }) => {
        try {
            handler(event.channelId ?? null);
        } catch (err) {
            console.error("[P2PShare] handler de VOICE_CHANNEL_SELECT falhou", err);
        }
    };

    FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT" as any, listener);
    return () => FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT" as any, listener);
}

/** Assina MESSAGE_DELETE. Devolve a função de cancelamento. */
export function onMessageDelete(handler: (channelId: string, messageId: string) => void): () => void {
    const listener = (event: { channelId: string; id: string; }) => {
        try {
            handler(event.channelId, event.id);
        } catch (err) {
            console.error("[P2PShare] handler de MESSAGE_DELETE falhou", err);
        }
    };

    FluxDispatcher.subscribe("MESSAGE_DELETE", listener);
    return () => FluxDispatcher.unsubscribe("MESSAGE_DELETE", listener);
}
