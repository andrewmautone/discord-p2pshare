/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { computePerPeerBitrate, smoothBudgetMbps, usableBudgetMbps } from "./bitrate";
import type { HandshakeKind } from "./codec";
import {
    ICE_GATHER_TIMEOUT_MS,
    ICE_SERVERS,
    PEER_CONNECT_TIMEOUT_MS,
    PEER_DROP_GRACE_MS
} from "./constants";

/**
 * Qualidade pedida ao codificador, aplicada em todos os peers.
 *
 * `scaleResolutionDownBy` divide a resolucao da captura; 1 mantem o original.
 */
export interface BroadcastQuality {
    maxFramerate?: number;
    scaleResolutionDownBy?: number;
}

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
    private budgetMbps: number;
    private auto: boolean;

    onCountChange?: (count: number) => void;
    private quality: BroadcastQuality = {};

    /**
     * Banda medida pelo proprio WebRTC, ou null enquanto ninguem mediu.
     *
     * Fica separada do orcamento escolhido para que sair do automatico nao
     * apague a medicao — voltar para o automatico reaproveita o que ja' se
     * sabe da rede, em vez de recomecar do zero.
     */
    private measuredMbps: number | null = null;
    private statsTimer: ReturnType<typeof setInterval> | null = null;

    /** Avisa a interface quanto esta sendo enviado para cada espectador. */
    onBitrateChange?: (perPeerBps: number, budgetMbps: number, medido: boolean) => void;

    constructor(
        private readonly stream: MediaStream,
        private readonly transport: PeerTransport,
        opts: { budgetMbps: number; createPeer?: PeerFactory; auto?: boolean; }
    ) {
        this.budgetMbps = opts.budgetMbps;
        this.auto = opts.auto ?? true;
        this.createPeer = opts.createPeer ?? defaultFactory;
    }

    /**
     * Orcamento escolhido na mao, ou automatico quando null.
     *
     * No automatico o valor sai da medicao; sem medicao ainda, do orcamento
     * configurado — melhor um palpite razoavel que travar em nada.
     */
    setBudget(mbps: number | null): void {
        this.auto = mbps === null;
        if (mbps !== null) this.budgetMbps = mbps;
        this.applyBitrate();
    }

    get autoBudget(): boolean {
        return this.auto;
    }

    /** Orcamento em vigor agora, medido ou escolhido. */
    get effectiveBudgetMbps(): number {
        return this.auto && this.measuredMbps !== null
            ? this.measuredMbps
            : this.budgetMbps;
    }

    /**
     * Pergunta a cada conexao quanto ela acha que cabe no cano de saida.
     *
     * `availableOutgoingBitrate` e' a estimativa do proprio WebRTC para o par
     * de candidatos em uso. E' o unico numero honesto sobre a rede: qualquer
     * outro seria chute sobre o plano contratado.
     */
    private async sampleBandwidth(): Promise<void> {
        const amostras: number[] = [];

        for (const pc of this.peers.values()) {
            try {
                const stats = await pc.getStats();
                stats.forEach((report: any) => {
                    if (report.type === "candidate-pair" && report.availableOutgoingBitrate) {
                        amostras.push(report.availableOutgoingBitrate / 1_000_000);
                    }
                });
            } catch { /* conexao morrendo: a proxima amostra resolve */ }
        }

        const util = usableBudgetMbps(amostras);
        if (util === null) return;

        this.measuredMbps = smoothBudgetMbps(this.measuredMbps, util);
        if (this.auto) this.applyBitrate();
    }

    private startSampling(): void {
        if (this.statsTimer !== null) return;

        this.statsTimer = setInterval(() => void this.sampleBandwidth(), 3000);

        // Medir banda nao e' motivo para manter um processo vivo. No
        // navegador nao existe e nao faz falta; em teste, sem isto a suite
        // nunca termina — foi assim que este esquecimento apareceu.
        (this.statsTimer as any)?.unref?.();
    }

    private stopSampling(): void {
        if (this.statsTimer === null) return;
        clearInterval(this.statsTimer);
        this.statsTimer = null;
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
        // Sem ninguem conectado nao ha o que medir: o cano so' revela a
        // largura quando esta' passando alguma coisa por ele.
        this.startSampling();
        this.onCountChange?.(this.peers.size);

        await this.transport.send("answer", fromUserId, pc.localDescription?.sdp ?? answer.sdp!);
    }

    /** Troca a qualidade em transmissao, sem recapturar a tela. */
    setQuality(quality: BroadcastQuality): void {
        this.quality = quality;
        this.applyBitrate();
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
        this.stopSampling();
        this.onCountChange?.(0);
    }

    /** Redistribui o orçamento de upload entre todos os viewers atuais. */
    private applyBitrate(): void {
        const budget = this.effectiveBudgetMbps;
        const maxBitrate = computePerPeerBitrate(budget, this.peers.size);

        this.onBitrateChange?.(maxBitrate, budget, this.auto && this.measuredMbps !== null);

        for (const pc of this.peers.values()) {
            for (const sender of pc.getSenders()) {
                if (!sender.track) continue;

                const params = sender.getParameters();
                if (!params.encodings?.length) params.encodings = [{}];
                params.encodings[0].maxBitrate = maxBitrate;
                params.degradationPreference = "maintain-framerate";

                // undefined remove o limite; nao adianta apagar a chave, o
                // Chromium mantem o ultimo valor aplicado.
                params.encodings[0].maxFramerate = this.quality.maxFramerate;
                params.encodings[0].scaleResolutionDownBy =
                    this.quality.scaleResolutionDownBy ?? 1;

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
    private dropTimer: ReturnType<typeof setTimeout> | null = null;

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
            if (pc.connectionState === "connected") {
                this.clearTimer();
                this.clearDropTimer();
            }

            // O emissor fechou o Discord ou saiu do canal: a conexão morre e
            // não há por que manter uma janela preta aberta.
            if (pc.connectionState === "closed") {
                this.fail("a transmissão foi encerrada");
            }

            // `disconnected` não é fim. É o estado de uma oscilação de rede —
            // Wi-Fi trocando de canal, um punhado de pacotes perdidos — e o
            // próprio WebRTC costuma se recuperar em poucos segundos.
            //
            // Tratar como encerramento matava transmissão que ia voltar
            // sozinha, e quem assistia via "a transmissão foi encerrada" sem
            // nada ter acabado. Agora damos esse tempo antes de desistir.
            if (pc.connectionState === "disconnected") {
                this.startDropTimer();
            }

            // Sem inspecionar os candidatos ICE não dá para saber a causa:
            // pode ser NAT dos dois lados, firewall, ou STUN inalcançável.
            // O texto anterior afirmava CGNAT, e medição em rede residencial
            // mostrou NAT cone — o palpite estava errado.
            if (pc.connectionState === "failed") {
                this.fail(
                    "não foi possível abrir a conexão direta com quem transmite. " +
                    "Costuma ser rede que bloqueia conexão direta, dos dois lados"
                );
            }
        };

        this.connectTimer = setTimeout(
            () => this.fail(
                "tempo esgotado esperando a conexão com quem transmite"
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
        this.clearDropTimer();
        if (this.pc) {
            this.pc.onconnectionstatechange = null;
            this.pc.close();
            this.pc = null;
        }
    }

    /**
     * Espera a conexão voltar antes de dar por encerrada.
     *
     * Só desiste se o tempo passar sem reconectar; enquanto isso a janela
     * segue aberta, com a última imagem congelada — que é melhor que fechar
     * tudo e obrigar a pessoa a pedir a transmissão de novo.
     */
    private startDropTimer(): void {
        if (this.dropTimer !== null) return;

        this.dropTimer = setTimeout(() => {
            this.dropTimer = null;
            this.fail("a conexão caiu e não voltou");
        }, PEER_DROP_GRACE_MS);
    }

    private clearDropTimer(): void {
        if (this.dropTimer === null) return;

        clearTimeout(this.dropTimer);
        this.dropTimer = null;
    }

    private clearTimer(): void {
        if (this.connectTimer) {
            clearTimeout(this.connectTimer);
            this.connectTimer = null;
        }
    }

    private fail(reason: string): void {
        this.clearTimer();
        this.clearDropTimer();
        this.onFailed?.(reason);
    }
}
