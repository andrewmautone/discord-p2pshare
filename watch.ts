/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { host } from "./host";
import { type PeerTransport, ViewerPeer } from "./peers";
import { type Beacon, observeSignals, sendHandshake } from "./signaling";

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

/** Quantas transmissões estou assistindo agora. */
export function watchingCount(): number {
    return watching.size;
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
        host.mountOverlay(
            beacon.sessionId,
            stream,
            beacon.broadcasterName,
            () => stopWatching(beacon.sessionId),
            {
                closeLabel: `Parar de assistir ${beacon.broadcasterName}`,
                userId: beacon.broadcasterId
            }
        );
    };

    peer.onFailed = reason => {
        host.toast(reason, "error");
        stopWatching(beacon.sessionId);
    };

    try {
        await peer.start();
        host.toast(`Conectando com ${beacon.broadcasterName}…`, "info");
    } catch (err) {
        host.toast(`não deu para pedir a transmissão: ${(err as Error).message}`, "error");
        stopWatching(beacon.sessionId);
    }
}

/**
 * Para de assistir. Fecha a conexão de verdade — o emissor vê você sair da
 * lista e o vídeo para de consumir banda dos dois lados.
 *
 * Se a transmissão continua no ar, o aviso volta a aparecer: sem isso, sair
 * uma vez significaria não conseguir voltar até o emissor recomeçar tudo.
 */
export function stopWatching(sessionId: string): void {
    watching.get(sessionId)?.close();
    watching.delete(sessionId);
    host.unmountOverlay(sessionId);

    for (const beacon of beacons.values()) {
        if (beacon.sessionId !== sessionId) continue;

        host.announceBeacon(
            { sessionId: beacon.sessionId, broadcasterName: beacon.broadcasterName },
            () => { void startWatching(beacon); }
        );
        return;
    }
}

/** Assina o chat para descobrir beacons e receber answers. Devolve a limpeza. */
export function initWatcher(): () => void {
    const myId = host.getCurrentUserId();

    const unsubscribe = observeSignals({
        onBeacon: beacon => {
            // Meu próprio beacon não me interessa como viewer.
            if (beacon.broadcasterId === myId) return;

            beacons.set(beacon.messageId, beacon);
            notifyBeacons();

            host.announceBeacon(
                { sessionId: beacon.sessionId, broadcasterName: beacon.broadcasterName },
                () => { void startWatching(beacon); }
            );
        },

        onBeaconGone: (_channelId, messageId) => {
            const beacon = beacons.get(messageId);
            if (!beacon) return;

            beacons.delete(messageId);
            host.revokeBeacon(beacon.sessionId);
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

        // Esvaziar os beacons ANTES de parar de assistir: stopWatching
        // re-anuncia transmissões ainda no ar, e no desligamento do plugin
        // isso deixaria avisos órfãos na tela.
        for (const beacon of beacons.values()) host.revokeBeacon(beacon.sessionId);
        beacons.clear();

        for (const sessionId of [...watching.keys()]) stopWatching(sessionId);
        host.unmountAllOverlays();
        notifyBeacons();
    };
}
