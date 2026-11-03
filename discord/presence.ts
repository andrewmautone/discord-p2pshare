/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";
import { FluxDispatcher, PresenceStore } from "@webpack/common";

import { getUsername } from "./api";

/** Contraparte Vencord de host/bd/api.ts — ver os comentários de lá. */

const VoiceStateStore = findStoreLazy("VoiceStateStore");
const ACTIVITY_SOCKET = "P2PShare";

export function setBroadcastActivity(activity: object | null): boolean {
    try {
        FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: ACTIVITY_SOCKET } as any);
        return true;
    } catch (err) {
        console.warn("[P2PShare] não deu para publicar o status", err);
        return false;
    }
}

export function getVoiceChannelMembers(channelId: string) {
    let states: any;
    try {
        states = VoiceStateStore.getVoiceStatesForChannel(channelId);
    } catch {
        return [];
    }

    const list: any[] = Array.isArray(states) ? states : Object.values(states ?? {});
    const ids = new Set<string>();
    for (const s of list) {
        const id = s?.userId ?? s?.user_id;
        if (typeof id === "string") ids.add(id);
    }

    return [...ids].map(userId => ({
        userId,
        username: getUsername(userId),
        activities: (PresenceStore.getActivities(userId) ?? []) as unknown[]
    }));
}

export function onPresenceChange(handler: () => void): () => void {
    const events = ["PRESENCE_UPDATES", "PRESENCES_REPLACE", "VOICE_STATE_UPDATES"];
    const listener = () => handler();
    for (const e of events) FluxDispatcher.subscribe(e as any, listener);
    return () => {
        for (const e of events) FluxDispatcher.unsubscribe(e as any, listener);
    };
}
