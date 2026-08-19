/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CaptureError, captureScreen } from "./capture";
import { newSessionId } from "./codec";
import { host } from "./host";
import { BroadcastPeers, type BroadcastQuality, type PeerTransport } from "./peers";
import { observeSignals, postBeacon, removeBeacon, sendHandshake } from "./signaling";

interface Session {
    sessionId: string;
    channelId: string;
    beaconId: string;
    stream: MediaStream;
    peers: BroadcastPeers;
    unsubscribe: () => void;
    /** Cancela os vigias de saída de canal e de fechamento do Discord. */
    unwatchExit: () => void;
}

/** Escolha do usuário, em termos que ele entende. */
export interface QualityChoice {
    /** Altura máxima em pixels; null mantém a resolução da captura. */
    maxHeight: number | null;
    /** Quadros por segundo; null deixa o navegador decidir. */
    maxFramerate: number | null;
}

const DEFAULT_QUALITY: QualityChoice = { maxHeight: null, maxFramerate: null };

export interface BroadcastState {
    active: boolean;
    viewers: number;
}

let session: Session | null = null;
let quality: QualityChoice = { ...DEFAULT_QUALITY };
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

export function getQuality(): QualityChoice {
    return quality;
}

/**
 * Traduz a escolha do usuário para o que o codificador entende e aplica.
 *
 * A conta da escala precisa da altura real da captura: pedir 720p a partir de
 * uma tela 1440p é dividir por 2, mas a partir de 1080p é por 1,5.
 */
export function setQuality(choice: QualityChoice): void {
    quality = choice;
    if (!session) return;

    const track = session.stream.getVideoTracks()[0];
    const sourceHeight = track?.getSettings().height;

    const encoding: BroadcastQuality = {
        maxFramerate: choice.maxFramerate ?? undefined,
        scaleResolutionDownBy:
            choice.maxHeight && sourceHeight && sourceHeight > choice.maxHeight
                ? sourceHeight / choice.maxHeight
                : 1
    };

    session.peers.setQuality(encoding);

    // Também pede à captura: baixar o fps na origem poupa CPU de quem
    // transmite, coisa que mexer só no codificador não faz.
    if (track && choice.maxFramerate) {
        track.applyConstraints({ frameRate: { max: choice.maxFramerate } })
            .catch(err => console.warn("[P2PShare] a captura recusou o fps pedido", err));
    }
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
        stream = await captureScreen(
            { pickSource: host.pickSource },
            {
                audio: host.shouldCaptureAudio(),
                audioDeviceId: host.getAudioDeviceId()
            }
        );
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

    // Sair da voz, trocar de canal ou fechar o Discord tem que cortar na hora:
    // uma transmissão viva sem ninguém do outro lado é banda gasta à toa, e o
    // aviso ficaria no chat convidando gente para uma tela que não existe mais.
    const onVoiceChange = host.onVoiceChannelChange(id => {
        if (id !== channelId) void stopBroadcast();
    });

    const onUnload = () => {
        // beforeunload não espera promessa: fechar os peers é o que dá para
        // garantir, e é o que corta o vídeo de quem assiste na hora.
        session?.peers.closeAll();
        void stopBroadcast();
    };
    window.addEventListener("beforeunload", onUnload);

    const unwatchExit = () => {
        onVoiceChange();
        window.removeEventListener("beforeunload", onUnload);
    };

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
        unwatchExit();
        unsubscribe();
        stream.getTracks().forEach(track => track.stop());
        host.toast(`não deu para anunciar a transmissão: ${(err as Error).message}`, "error");
        return;
    }

    session = { sessionId, channelId, beaconId, stream, peers, unsubscribe, unwatchExit };
    // Reaplica a escolha anterior: quem baixou para 720p não quer voltar
    // para 1440p só porque reiniciou a transmissão.
    setQuality(quality);

    // Prévia da própria tela. Muda de propósito: o áudio capturado é o do
    // sistema, e reproduzi-lo de volta nos alto-falantes microfonaria.
    // Fechar a prévia não encerra a transmissão — é só uma janela.
    host.mountOverlay(
        selfPreviewKey(sessionId),
        stream,
        "Sua tela",
        () => host.unmountOverlay(selfPreviewKey(sessionId)),
        {
            muted: true,
            closable: false,
            userId: host.getCurrentUserId()
        }
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
    current.unwatchExit();
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
