/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { HandshakeKind } from "./codec";
import { PROTOCOL_VERSION } from "./constants";
import { finalizeEvent, type NostrEvent, P2PSHARE_KIND } from "./nostr/event";
import { openRoom, roomTopic, sealRoom } from "./nostr/room";
import { generateSecretKey, getPublicKey } from "./nostr/schnorr";

/**
 * Descoberta e handshake pelos relays Nostr, sem nada no Discord.
 *
 * Quem transmite publica um aviso "ao vivo" na sala do canal de voz a cada
 * poucos segundos; quem tem o plugin e enxerga aquele canal recebe e mostra o
 * selo. O aviso expira sozinho se parar de ser renovado — transmissão que
 * caiu sem se despedir some em segundos. O offer/answer passa pela mesma
 * sala, endereçado pelo id do usuário.
 *
 * Módulo sem Discord: recebe o pool de relays e a identidade de fora.
 */

export interface LiveBroadcast {
    channelId: string;
    sessionId: string;
    userId: string;
    name: string;
    /** Chave Nostr de quem anunciou: o answer tem que vir dela. */
    pubkey: string;
    expiresAt: number;
}

export interface SignalEvent {
    channelId: string;
    sessionId: string;
    kind: HandshakeKind;
    fromUserId: string;
    sdp: string;
}

export interface PoolLike {
    setTopics(topics: readonly string[]): void;
    publish(event: NostrEvent): void;
    onEvent(listener: (e: NostrEvent) => void): () => void;
}

export interface DiscoveryOptions {
    me: () => { id: string; name: string; };
    secretKey?: string;
    /** Validade de um aviso sem renovação. */
    ttlMs?: number;
    renewMs?: number;
    /** Eventos mais velhos que isso (ou do futuro além disso) são ignorados. */
    maxSkewMs?: number;
    now?: () => number;
}

type Wire =
    | { v: number; t: "live"; s: string; u: string; n: string; ttl: number; }
    | { v: number; t: "end"; s: string; u: string; }
    | { v: number; t: HandshakeKind; s: string; from: string; to: string; sdp: string; };

const MAX_TTL_MS = 30_000;

export class Discovery {
    private readonly secretKey: string;
    readonly pubkey: string;
    private readonly ttlMs: number;
    private readonly renewMs: number;
    private readonly maxSkewMs: number;

    private topicToChannel = new Map<string, string>();
    private watched: string[] = [];
    private lives = new Map<string, LiveBroadcast>();
    /** Sessão → chave que a anunciou primeiro. Ninguém mais fala por ela. */
    private owners = new Map<string, string>();
    /** Minha transmissão no ar, se houver. */
    private mine: { channelId: string; sessionId: string; timer: ReturnType<typeof setInterval>; } | null = null;

    private liveListeners = new Set<(list: LiveBroadcast[]) => void>();
    private signalListeners = new Set<(s: SignalEvent) => void>();
    private pruneTimer: ReturnType<typeof setInterval>;
    private unsubPool: () => void;

    constructor(private pool: PoolLike, private opts: DiscoveryOptions) {
        this.secretKey = opts.secretKey ?? generateSecretKey();
        this.pubkey = getPublicKey(this.secretKey);
        this.ttlMs = opts.ttlMs ?? 15_000;
        this.renewMs = opts.renewMs ?? 5_000;
        this.maxSkewMs = opts.maxSkewMs ?? 120_000;

        this.unsubPool = pool.onEvent(e => { void this.handle(e); });
        this.pruneTimer = setInterval(() => this.prune(), 1_000);
    }

    private now(): number {
        return this.opts.now?.() ?? Date.now();
    }

    /** Canais cujo aviso quero ver. Sempre inclui o da minha transmissão. */
    async watch(channelIds: readonly string[]): Promise<void> {
        const wanted = [...new Set([...channelIds, ...(this.mine ? [this.mine.channelId] : [])])].sort();
        if (wanted.join() === this.watched.join()) return;
        this.watched = wanted;

        const map = new Map<string, string>();
        for (const id of wanted) map.set(await roomTopic(id), id);
        // Outra chamada pode ter trocado a lista enquanto calculávamos.
        if (wanted.join() !== this.watched.join()) return;

        this.topicToChannel = map;
        this.pool.setTopics([...map.keys()]);

        // Aviso de canal que deixei de olhar sai da lista.
        let changed = false;
        for (const [sid, live] of this.lives) {
            if (!wanted.includes(live.channelId)) {
                this.lives.delete(sid);
                changed = true;
            }
        }
        if (changed) this.emitLive();
    }

    live(): LiveBroadcast[] {
        return [...this.lives.values()];
    }

    onLive(listener: (list: LiveBroadcast[]) => void): () => void {
        this.liveListeners.add(listener);
        return () => this.liveListeners.delete(listener);
    }

    onSignal(listener: (s: SignalEvent) => void): () => void {
        this.signalListeners.add(listener);
        return () => this.signalListeners.delete(listener);
    }

    /** Começa a anunciar. Devolve a função que para (e avisa o fim). */
    startLive(channelId: string, sessionId: string): () => void {
        this.stopLive();

        const announce = () => {
            const me = this.opts.me();
            void this.send(channelId, { v: PROTOCOL_VERSION, t: "live", s: sessionId, u: me.id, n: me.name, ttl: this.ttlMs });
        };

        this.mine = { channelId, sessionId, timer: setInterval(announce, this.renewMs) };
        void this.watch(this.watched);
        announce();

        return () => {
            if (this.mine?.sessionId === sessionId) this.stopLive();
        };
    }

    private stopLive(): void {
        if (!this.mine) return;
        const { channelId, sessionId, timer } = this.mine;
        clearInterval(timer);
        this.mine = null;
        void this.send(channelId, { v: PROTOCOL_VERSION, t: "end", s: sessionId, u: this.opts.me().id });
    }

    async sendSignal(channelId: string, sessionId: string, kind: HandshakeKind, toUserId: string, sdp: string): Promise<void> {
        await this.send(channelId, { v: PROTOCOL_VERSION, t: kind, s: sessionId, from: this.opts.me().id, to: toUserId, sdp });
    }

    close(): void {
        this.stopLive();
        clearInterval(this.pruneTimer);
        this.unsubPool();
        this.liveListeners.clear();
        this.signalListeners.clear();
        this.lives.clear();
    }

    private async send(channelId: string, wire: Wire): Promise<void> {
        const event = await finalizeEvent({
            kind: P2PSHARE_KIND,
            tags: [["t", await roomTopic(channelId)]],
            content: await sealRoom(channelId, wire),
            created_at: Math.floor(this.now() / 1000)
        }, this.secretKey);
        this.pool.publish(event);
    }

    private emitLive(): void {
        const list = this.live();
        for (const l of this.liveListeners) {
            try {
                l(list);
            } catch (err) {
                console.error("[P2PShare] ouvinte de aviso falhou", err);
            }
        }
    }

    private prune(): void {
        const now = this.now();
        let changed = false;
        for (const [sid, live] of this.lives) {
            if (live.expiresAt <= now) {
                this.lives.delete(sid);
                changed = true;
            }
        }
        if (changed) this.emitLive();
    }

    /** Exposto para testes; em produção vem do pool. */
    async handle(event: NostrEvent): Promise<void> {
        if (event.pubkey === this.pubkey) return;

        const now = this.now();
        if (Math.abs(event.created_at * 1000 - now) > this.maxSkewMs) return;

        const topic = event.tags.find(t => t[0] === "t")?.[1];
        const channelId = topic ? this.topicToChannel.get(topic) : undefined;
        if (!channelId) return;

        const wire = await openRoom(channelId, event.content) as Wire | null;
        if (!wire || wire.v !== PROTOCOL_VERSION || typeof wire.s !== "string" || !wire.s) return;

        if (wire.t === "live" || wire.t === "end") {
            if (typeof wire.u !== "string" || !wire.u) return;

            // Quem anunciou a sessão primeiro é o dono; outra chave não a sequestra.
            const owner = this.owners.get(wire.s);
            if (owner && owner !== event.pubkey) return;
            this.owners.set(wire.s, event.pubkey);

            if (wire.t === "end") {
                if (this.lives.delete(wire.s)) this.emitLive();
                return;
            }

            const ttl = Math.min(MAX_TTL_MS, Math.max(1_000, Number(wire.ttl) || this.ttlMs));
            const prev = this.lives.get(wire.s);
            this.lives.set(wire.s, {
                channelId,
                sessionId: wire.s,
                userId: wire.u,
                name: typeof wire.n === "string" && wire.n ? wire.n.slice(0, 64) : wire.u,
                pubkey: event.pubkey,
                expiresAt: now + ttl
            });
            if (!prev) this.emitLive();
            return;
        }

        if (wire.t !== "offer" && wire.t !== "answer") return;
        if (wire.to !== this.opts.me().id || typeof wire.from !== "string" || typeof wire.sdp !== "string") return;

        if (wire.t === "offer") {
            // Offer só vale para a transmissão que estou fazendo agora.
            if (this.mine?.sessionId !== wire.s || this.mine.channelId !== channelId) return;
        } else {
            // Answer só vale vindo da mesma chave que anunciou a sessão.
            if (this.owners.get(wire.s) !== event.pubkey) return;
        }

        const signal: SignalEvent = { channelId, sessionId: wire.s, kind: wire.t, fromUserId: wire.from, sdp: wire.sdp };
        for (const l of this.signalListeners) {
            try {
                l(signal);
            } catch (err) {
                console.error("[P2PShare] ouvinte de sinal falhou", err);
            }
        }
    }
}
