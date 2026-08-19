/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { computePerPeerBitrate } from "./bitrate";
import type { HandshakeKind } from "./codec";
import { ICE_GATHER_TIMEOUT_MS, ICE_SERVERS, PEER_CONNECT_TIMEOUT_MS } from "./constants";

export interface PeerTransport {
    send(kind: HandshakeKind, targetUserId: string, sdp: string): Promise<void>;
}

export type PeerFactory = (config: RTCConfiguration) => RTCPeerConnection;

const defaultFactory: PeerFactory = config => new RTCPeerConnection(config);

const PEER_CONFIG: RTCConfiguration = { iceServers: ICE_SERVERS };

/**
 * Espera o ICE gathering terminar, com teto de tempo.
 *
 * Sinalização por chat não comporta trickle ICE — é uma mensagem por lado,
 * então o SDP precisa sair já com todos os candidatos dentro.
 */
export function waitForIceGathering(
    pc: RTCPeerConnection,
    timeoutMs = ICE_GATHER_TIMEOUT_MS
): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();

    return new Promise(resolve => {
        const finish = () => {
            clearTimeout(timer);
            pc.onicegatheringstatechange = null;
            resolve();
        };

        const timer = setTimeout(finish, timeoutMs);
        pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === "complete") finish();
        };
    });
}

/** Lado emissor: uma conexão por viewer, todas carregando a mesma track. */
export class BroadcastPeers {
    private readonly peers = new Map<string, RTCPeerConnection>();
    private readonly createPeer: PeerFactory;
    private readonly budgetMbps: number;

    onCountChange?: (count: number) => void;

    constructor(
        private readonly stream: MediaStream,
        private readonly transport: PeerTransport,
        opts: { budgetMbps: number; createPeer?: PeerFactory; }
    ) {
        this.budgetMbps = opts.budgetMbps;
        this.createPeer = opts.createPeer ?? defaultFactory;
    }

    get viewerCount(): number {
        return this.peers.size;
    }

    /** Ids de quem está conectado agora, para o emissor saber quem é. */
    get viewerIds(): string[] {
        return [...this.peers.keys()];
    }

    async handleOffer(fromUserId: string, sdp: string): Promise<void> {
        // Offer repetida significa que o viewer reconectou: descarta a antiga.
        this.peers.get(fromUserId)?.close();

        const pc = this.createPeer(PEER_CONFIG);
        this.peers.set(fromUserId, pc);

        for (const track of this.stream.getTracks()) {
            pc.addTrack(track, this.stream);
        }

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed" || pc.connectionState === "closed") {
                this.removePeer(fromUserId);
            }
        };

        await pc.setRemoteDescription({ type: "offer", sdp } as RTCSessionDescriptionInit);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering(pc);

        this.applyBitrate();
        this.onCountChange?.(this.peers.size);

        await this.transport.send("answer", fromUserId, pc.localDescription?.sdp ?? answer.sdp!);
    }

    removePeer(userId: string): void {
        const pc = this.peers.get(userId);
        if (!pc) return;

        // Apaga do mapa antes de fechar: close() dispara
        // onconnectionstatechange, que reentraria aqui.
        this.peers.delete(userId);
        pc.onconnectionstatechange = null;
        pc.close();

        this.applyBitrate();
        this.onCountChange?.(this.peers.size);
    }

    closeAll(): void {
        for (const pc of this.peers.values()) {
            pc.onconnectionstatechange = null;
            pc.close();
        }
        this.peers.clear();
        this.onCountChange?.(0);
    }

    /** Redistribui o orçamento de upload entre todos os viewers atuais. */
    private applyBitrate(): void {
        const maxBitrate = computePerPeerBitrate(this.budgetMbps, this.peers.size);

        for (const pc of this.peers.values()) {
            for (const sender of pc.getSenders()) {
                if (!sender.track) continue;

                const params = sender.getParameters();
                if (!params.encodings?.length) params.encodings = [{}];
                params.encodings[0].maxBitrate = maxBitrate;
                params.degradationPreference = "maintain-framerate";

                sender.setParameters(params).catch(err =>
                    console.warn("[P2PShare] não deu para aplicar o bitrate", err));
            }
        }
    }
}

/** Lado receptor: uma conexão só, recebendo do broadcaster. */
export class ViewerPeer {
    private pc: RTCPeerConnection | null = null;
    private connectTimer: ReturnType<typeof setTimeout> | null = null;

    onStream?: (stream: MediaStream) => void;
    onFailed?: (reason: string) => void;

    constructor(
        private readonly transport: PeerTransport,
        private readonly broadcasterId: string,
        private readonly opts: { createPeer?: PeerFactory; } = {}
    ) { }

    async start(): Promise<void> {
        const pc = (this.opts.createPeer ?? defaultFactory)(PEER_CONFIG);
        this.pc = pc;

        // recvonly: o viewer não manda mídia nenhuma.
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });

        pc.ontrack = event => {
            const stream = event.streams[0];
            if (stream) {
                this.clearTimer();
                this.onStream?.(stream);
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "connected") this.clearTimer();
            if (pc.connectionState === "failed") {
                this.fail(
                    "a conexão P2P falhou — provável NAT simétrico (CGNAT). " +
                    "Sem TURN não tem como conectar"
                );
            }
        };

        this.connectTimer = setTimeout(
            () => this.fail(
                "tempo esgotado esperando a conexão — provável NAT simétrico (CGNAT)"
            ),
            PEER_CONNECT_TIMEOUT_MS
        );

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);

        await this.transport.send("offer", this.broadcasterId, pc.localDescription?.sdp ?? offer.sdp!);
    }

    async handleAnswer(sdp: string): Promise<void> {
        if (!this.pc) return;
        await this.pc.setRemoteDescription({ type: "answer", sdp } as RTCSessionDescriptionInit);
    }

    close(): void {
        this.clearTimer();
        if (this.pc) {
            this.pc.onconnectionstatechange = null;
            this.pc.close();
            this.pc = null;
        }
    }

    private clearTimer(): void {
        if (this.connectTimer) {
            clearTimeout(this.connectTimer);
            this.connectTimer = null;
        }
    }

    private fail(reason: string): void {
        this.clearTimer();
        this.onFailed?.(reason);
    }
}
