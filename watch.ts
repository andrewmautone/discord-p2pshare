/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { host } from "./host";
import { type PeerTransport, ViewerPeer } from "./peers";
import { type Beacon, observeSignals, sendHandshake } from "./signaling";

/**
 * Lado de quem assiste.
 *
 * Os avisos chegam pelos relays (ver signaling.ts) de todos os canais de voz
 * do servidor aberto, e viram o selo de "transmitindo" na lista — sem som e
 * sem notificação. O vídeo só conecta quando a pessoa está na mesma chamada e
 * clica para assistir.
 */

/** Avisos vivos, por chave. */
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

/** Uma transmissão está no canal em que estou agora? */
export function beaconIsHere(beacon: Beacon): boolean {
    const current = host.getVoiceChannelId();
    return current !== null && beacon.channelId === current;
}

export async function startWatching(beacon: Beacon): Promise<void> {
    if (watching.has(beacon.sessionId)) return;

    // O selo aparece para o servidor todo, mas o vídeo é de quem está na sala.
    if (!beaconIsHere(beacon)) {
        host.toast(`Entre na chamada de ${beacon.broadcasterName} para assistir`, "info");
        return;
    }

    const transport: PeerTransport = {
        send: (kind, targetUserId, sdp) =>
            sendHandshake(beacon.channelId, beacon.sessionId, kind, targetUserId, sdp)
    };

    const peer = new ViewerPeer(transport, beacon.broadcasterId);
    watching.set(beacon.sessionId, peer);

    // Sem isto o botão "Assistir" continua no quadro depois do clique.
    notifyBeacons();

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
 * lista e o vídeo para de consumir banda dos dois lados. O selo continua: dá
 * para clicar de novo enquanto a transmissão estiver no ar.
 */
export function stopWatching(sessionId: string): void {
    watching.get(sessionId)?.close();
    watching.delete(sessionId);
    host.unmountOverlay(sessionId);
    notifyBeacons();
}

/** Assina os relays para descobrir transmissões e receber answers. Devolve a limpeza. */
export function initWatcher(): () => void {
    const unsubscribe = observeSignals({
        onBeacon: beacon => {
            beacons.set(beacon.messageId, beacon);
            notifyBeacons();
        },

        onBeaconGone: beacon => {
            if (!beacons.delete(beacon.messageId)) return;
            // Aviso que sumiu = transmissão acabou (ou quem transmite saiu da sala).
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

    // Sair da chamada encerra o que eu estava vendo dela.
    const unsubVoice = host.onVoiceChannelChange(channelId => {
        for (const b of beacons.values()) {
            if (b.channelId !== channelId && watching.has(b.sessionId)) stopWatching(b.sessionId);
        }
        notifyBeacons();
    });

    return () => {
        unsubscribe();
        unsubVoice();
        beacons.clear();
        for (const sessionId of [...watching.keys()]) stopWatching(sessionId);
        host.unmountAllOverlays();
        notifyBeacons();
    };
}
