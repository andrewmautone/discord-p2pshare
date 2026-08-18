/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast, Toasts } from "@webpack/common";

import { getCurrentUserId } from "./discord/api";
import { type PeerTransport, ViewerPeer } from "./peers";
import { type Beacon, observeSignals, sendHandshake } from "./signaling";
import { mountOverlay, unmountAllOverlays, unmountOverlay } from "./ui/ViewerOverlay";

/** Beacons vivos, por messageId. */
const beacons = new Map<string, Beacon>();
/** Sessões que estou assistindo, por sessionId. */
const watching = new Map<string, ViewerPeer>();

const beaconListeners = new Set<(beacons: Beacon[]) => void>();

function notifyBeacons(): void {
    const list = [...beacons.values()];
    for (const listener of beaconListeners) listener(list);
}

export function getActiveBeacons(): Beacon[] {
    return [...beacons.values()];
}

export function onBeaconsChange(listener: (beacons: Beacon[]) => void): () => void {
    beaconListeners.add(listener);
    return () => beaconListeners.delete(listener);
}

export function isWatching(sessionId: string): boolean {
    return watching.has(sessionId);
}

export async function startWatching(beacon: Beacon): Promise<void> {
    if (watching.has(beacon.sessionId)) return;

    const transport: PeerTransport = {
        send: (kind, targetUserId, sdp) =>
            sendHandshake(beacon.channelId, beacon.sessionId, kind, targetUserId, sdp)
    };

    const peer = new ViewerPeer(transport, beacon.broadcasterId);
    watching.set(beacon.sessionId, peer);

    peer.onStream = stream => {
        mountOverlay(
            beacon.sessionId,
            stream,
            beacon.broadcasterName,
            () => stopWatching(beacon.sessionId)
        );
    };

    peer.onFailed = reason => {
        showToast(reason, Toasts.Type.FAILURE);
        stopWatching(beacon.sessionId);
    };

    try {
        await peer.start();
        showToast(`Conectando com ${beacon.broadcasterName}…`, Toasts.Type.MESSAGE);
    } catch (err) {
        showToast(`não deu para pedir a transmissão: ${(err as Error).message}`, Toasts.Type.FAILURE);
        stopWatching(beacon.sessionId);
    }
}

export function stopWatching(sessionId: string): void {
    watching.get(sessionId)?.close();
    watching.delete(sessionId);
    unmountOverlay(sessionId);
}

/** Assina o chat para descobrir beacons e receber answers. Devolve a limpeza. */
export function initWatcher(): () => void {
    const myId = getCurrentUserId();

    const unsubscribe = observeSignals({
        onBeacon: beacon => {
            // Meu próprio beacon não me interessa como viewer.
            if (beacon.broadcasterId === myId) return;

            beacons.set(beacon.messageId, beacon);
            notifyBeacons();
        },

        onBeaconGone: (_channelId, messageId) => {
            const beacon = beacons.get(messageId);
            if (!beacon) return;

            beacons.delete(messageId);
            stopWatching(beacon.sessionId);
            notifyBeacons();
        },

        onHandshake: event => {
            if (event.kind !== "answer") return;

            watching.get(event.sessionId)
                ?.handleAnswer(event.sdp)
                .catch(err => console.error("[P2PShare] answer inválida", err));
        }
    });

    return () => {
        unsubscribe();
        for (const sessionId of [...watching.keys()]) stopWatching(sessionId);
        unmountAllOverlays();
        beacons.clear();
        notifyBeacons();
    };
}
