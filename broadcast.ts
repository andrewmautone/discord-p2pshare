/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast, Toasts } from "@webpack/common";

import { CaptureError, captureScreen } from "./capture";
import { newSessionId } from "./codec";
import { getCurrentUsername, getVoiceChannelId } from "./discord/api";
import { settings } from "./index";
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

function toast(message: string, type: string): void {
    showToast(message, type);
}

export async function startBroadcast(): Promise<void> {
    if (session) {
        toast("Você já está transmitindo", Toasts.Type.MESSAGE);
        return;
    }

    const channelId = getVoiceChannelId();
    if (!channelId) {
        toast("Entre num canal de voz primeiro", Toasts.Type.FAILURE);
        return;
    }

    let stream: MediaStream;
    try {
        stream = await captureScreen();
    } catch (err) {
        toast(
            err instanceof CaptureError
                ? err.message
                : `falha inesperada na captura: ${(err as Error).message}`,
            Toasts.Type.FAILURE
        );
        return;
    }

    const sessionId = newSessionId();
    const transport: PeerTransport = {
        send: (kind, targetUserId, sdp) =>
            sendHandshake(channelId, sessionId, kind, targetUserId, sdp)
    };

    const peers = new BroadcastPeers(stream, transport, {
        budgetMbps: settings.store.uploadBudgetMbps
    });
    peers.onCountChange = notify;

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
        beaconId = await postBeacon(channelId, sessionId, getCurrentUsername());
    } catch (err) {
        // Sem beacon ninguém descobre a transmissão: desfaz tudo.
        unsubscribe();
        stream.getTracks().forEach(track => track.stop());
        toast(`não deu para anunciar a transmissão: ${(err as Error).message}`, Toasts.Type.FAILURE);
        return;
    }

    session = { sessionId, channelId, beaconId, stream, peers, unsubscribe };
    notify();
    toast("Transmitindo via P2P", Toasts.Type.SUCCESS);
}

export async function stopBroadcast(): Promise<void> {
    const current = session;
    if (!current) return;

    // Zera antes de limpar: o evento "ended" da track reentraria aqui.
    session = null;

    current.unsubscribe();
    current.peers.closeAll();
    current.stream.getTracks().forEach(track => track.stop());

    try {
        await removeBeacon(current.channelId, current.beaconId);
    } catch (err) {
        console.warn("[P2PShare] não deu para apagar o beacon", err);
    }

    notify();
    toast("Transmissão encerrada", Toasts.Type.MESSAGE);
}
