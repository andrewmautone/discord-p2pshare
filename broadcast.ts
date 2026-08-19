/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CaptureError, captureScreen } from "./capture";
import { newSessionId } from "./codec";
import { host } from "./host";
import { BroadcastPeers, type PeerTransport } from "./peers";
import { observeSignals, postBeacon, removeBeacon, sendHandshake } from "./signaling";

interface Session {
    sessionId: string;
    channelId: string;
    beaconId: string;
    stream: MediaStream;
    peers: BroadcastPeers;
    unsubscribe: () => void;
}

export interface BroadcastState {
    active: boolean;
    viewers: number;
}

let session: Session | null = null;
const listeners = new Set<(state: BroadcastState) => void>();

/** Chave da prévia local, separada das sessões que estamos assistindo. */
function selfPreviewKey(sessionId: string): string {
    return `self:${sessionId}`;
}

function currentState(): BroadcastState {
    return { active: session !== null, viewers: session?.peers.viewerCount ?? 0 };
}

function notify(): void {
    const state = currentState();
    for (const listener of listeners) listener(state);
}

export function onBroadcastStateChange(listener: (state: BroadcastState) => void): () => void {
    listeners.add(listener);
    listener(currentState());
    return () => listeners.delete(listener);
}

export function isBroadcasting(): boolean {
    return session !== null;
}

export function getBroadcastState(): BroadcastState {
    return currentState();
}

export async function startBroadcast(): Promise<void> {
    if (session) {
        host.toast("Você já está transmitindo", "info");
        return;
    }

    const channelId = host.getVoiceChannelId();
    if (!channelId) {
        host.toast("Entre num canal de voz primeiro", "error");
        return;
    }

    let stream: MediaStream;
    try {
        stream = await captureScreen({ pickSource: host.pickSource });
    } catch (err) {
        host.toast(
            err instanceof CaptureError
                ? err.message
                : `falha inesperada na captura: ${(err as Error).message}`,
            "error"
        );
        return;
    }

    const sessionId = newSessionId();
    const transport: PeerTransport = {
        send: (kind, targetUserId, sdp) =>
            sendHandshake(channelId, sessionId, kind, targetUserId, sdp)
    };

    const peers = new BroadcastPeers(stream, transport, {
        budgetMbps: host.getBudgetMbps()
    });

    peers.onCountChange = () => {
        host.setOverlayViewers(
            selfPreviewKey(sessionId),
            peers.viewerIds.map(id => host.getUsername(id))
        );
        notify();
    };

    // Se o usuário parar a captura pelo diálogo nativo do Chromium, encerra tudo.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => { void stopBroadcast(); });

    const unsubscribe = observeSignals({
        onHandshake: event => {
            if (event.sessionId !== sessionId || event.kind !== "offer") return;

            peers.handleOffer(event.fromUserId, event.sdp)
                .catch(err => console.error("[P2PShare] falha ao responder offer", err));
        }
    });

    let beaconId: string;
    try {
        beaconId = await postBeacon(channelId, sessionId, host.getCurrentUsername());
    } catch (err) {
        // Sem beacon ninguém descobre a transmissão: desfaz tudo.
        unsubscribe();
        stream.getTracks().forEach(track => track.stop());
        host.toast(`não deu para anunciar a transmissão: ${(err as Error).message}`, "error");
        return;
    }

    session = { sessionId, channelId, beaconId, stream, peers, unsubscribe };

    // Prévia da própria tela. Muda de propósito: o áudio capturado é o do
    // sistema, e reproduzi-lo de volta nos alto-falantes microfonaria.
    // Fechar a prévia não encerra a transmissão — é só uma janela.
    host.mountOverlay(
        selfPreviewKey(sessionId),
        stream,
        "Sua tela",
        () => host.unmountOverlay(selfPreviewKey(sessionId)),
        { muted: true, closeLabel: "Fechar a prévia (não encerra a transmissão)" }
    );

    notify();
    host.toast("Transmitindo via P2P", "success");
}

export async function stopBroadcast(): Promise<void> {
    const current = session;
    if (!current) return;

    // Zera antes de limpar: o evento "ended" da track reentraria aqui.
    session = null;

    host.unmountOverlay(selfPreviewKey(current.sessionId));
    current.unsubscribe();
    current.peers.closeAll();
    current.stream.getTracks().forEach(track => track.stop());

    try {
        await removeBeacon(current.channelId, current.beaconId);
    } catch (err) {
        console.warn("[P2PShare] não deu para apagar o beacon", err);
    }

    notify();
    host.toast("Transmissão encerrada", "info");
}
