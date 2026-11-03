/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, SelectedGuildStore } from "@webpack/common";

import type { RelaySocket } from "../nostr/pool";

/**
 * Contraparte Vencord de host/bd/api.ts (descoberta pelos relays).
 * No Vencord a CSP precisa liberar os relays; o socket é o da página.
 */

const GuildChannelStore = findStoreLazy("GuildChannelStore");
const VoiceStateStore = findStoreLazy("VoiceStateStore");

export function getSelectedGuildId(): string | null {
    return SelectedGuildStore.getGuildId() ?? null;
}

export function getChannelGuildId(channelId: string): string | null {
    return ChannelStore.getChannel(channelId)?.guild_id ?? null;
}

export function getGuildVoiceChannelIds(guildId: string): string[] {
    const vocal: any[] = GuildChannelStore.getChannels(guildId)?.VOCAL ?? [];
    return vocal.map(e => e?.channel?.id).filter((id): id is string => typeof id === "string");
}

export function isUserInVoiceChannel(userId: string, channelId: string): boolean {
    const states = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
    return userId in states;
}

export function onNavigationChange(handler: () => void): () => void {
    const events = ["CHANNEL_SELECT", "GUILD_CREATE", "CHANNEL_CREATE", "CHANNEL_DELETE", "VOICE_STATE_UPDATES"];
    const listener = () => handler();
    for (const e of events) FluxDispatcher.subscribe(e as any, listener);
    return () => {
        for (const e of events) FluxDispatcher.unsubscribe(e as any, listener);
    };
}

export function openRelaySocket(url: string): RelaySocket {
    const ws = new WebSocket(url);
    const socket: RelaySocket = {
        onopen: null,
        onmessage: null,
        onclose: null,
        send: data => {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
        },
        close: () => ws.close()
    };
    ws.onopen = () => socket.onopen?.();
    ws.onmessage = e => socket.onmessage?.(String(e.data));
    ws.onclose = () => socket.onclose?.();
    return socket;
}
