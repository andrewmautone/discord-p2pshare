/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type NostrEvent, verifyEvent } from "./event";

/**
 * Conexões com vários relays em paralelo.
 *
 * Basta um relay funcionar: publica em todos, escuta todos e descarta o que
 * chega repetido. Relay que cai volta sozinho com espera crescente. O
 * transporte é injetado — no Discord ele passa pelo processo principal
 * (a CSP da página bloqueia WebSocket para fora), nos testes é falso.
 */

export interface RelaySocket {
    send(data: string): void;
    close(): void;
    onopen: (() => void) | null;
    onmessage: ((data: string) => void) | null;
    onclose: (() => void) | null;
}

export type SocketFactory = (url: string) => RelaySocket;

export interface PoolOptions {
    kind: number;
    /** Janela do `since` na inscrição, em segundos. */
    sinceSeconds?: number;
    reconnectBaseMs?: number;
    reconnectMaxMs?: number;
    /** Relógio injetável para testes. */
    now?: () => number;
}

interface Conn {
    url: string;
    socket: RelaySocket | null;
    open: boolean;
    retry: number;
    timer: ReturnType<typeof setTimeout> | null;
}

const SUB_ID = "p2ps";
const SEEN_LIMIT = 2000;

export class RelayPool {
    private conns: Conn[];
    private topics: string[] = [];
    private seen = new Set<string>();
    private closed = false;
    private listeners = new Set<(e: NostrEvent) => void>();

    constructor(urls: readonly string[], private factory: SocketFactory, private opts: PoolOptions) {
        this.conns = urls.map(url => ({ url, socket: null, open: false, retry: 0, timer: null }));
        for (const c of this.conns) this.connect(c);
    }

    get openCount(): number {
        return this.conns.filter(c => c.open).length;
    }

    onEvent(listener: (e: NostrEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Troca os tópicos escutados. Lista vazia cancela a inscrição. */
    setTopics(topics: readonly string[]): void {
        const next = [...new Set(topics)].sort();
        if (next.join() === this.topics.join()) return;
        this.topics = next;
        for (const c of this.conns) if (c.open) this.subscribe(c);
    }

    publish(event: NostrEvent): void {
        // O próprio eco não deve voltar como evento novo.
        this.remember(event.id);
        const frame = JSON.stringify(["EVENT", event]);
        for (const c of this.conns) {
            if (!c.open) continue;
            try {
                c.socket?.send(frame);
            } catch { /* o onclose cuida */ }
        }
    }

    close(): void {
        this.closed = true;
        for (const c of this.conns) {
            if (c.timer) clearTimeout(c.timer);
            c.timer = null;
            try {
                c.socket?.close();
            } catch { /* já fechado */ }
            c.socket = null;
            c.open = false;
        }
        this.listeners.clear();
    }

    private now(): number {
        return this.opts.now?.() ?? Date.now();
    }

    private connect(c: Conn): void {
        if (this.closed) return;

        let socket: RelaySocket;
        try {
            socket = this.factory(c.url);
        } catch {
            this.scheduleReconnect(c);
            return;
        }
        c.socket = socket;

        socket.onopen = () => {
            c.open = true;
            c.retry = 0;
            this.subscribe(c);
        };
        socket.onmessage = data => this.handle(data);
        socket.onclose = () => {
            if (c.socket !== socket) return;
            c.open = false;
            c.socket = null;
            this.scheduleReconnect(c);
        };
    }

    private scheduleReconnect(c: Conn): void {
        if (this.closed || c.timer) return;
        const base = this.opts.reconnectBaseMs ?? 2000;
        const max = this.opts.reconnectMaxMs ?? 60_000;
        const delay = Math.min(max, base * 2 ** c.retry);
        c.retry++;
        c.timer = setTimeout(() => {
            c.timer = null;
            this.connect(c);
        }, delay);
    }

    private subscribe(c: Conn): void {
        try {
            if (!this.topics.length) {
                c.socket?.send(JSON.stringify(["CLOSE", SUB_ID]));
                return;
            }
            const since = Math.floor(this.now() / 1000) - (this.opts.sinceSeconds ?? 30);
            c.socket?.send(JSON.stringify(["REQ", SUB_ID, { kinds: [this.opts.kind], "#t": this.topics, since }]));
        } catch { /* o onclose cuida */ }
    }

    private remember(id: string): boolean {
        if (this.seen.has(id)) return false;
        this.seen.add(id);
        if (this.seen.size > SEEN_LIMIT) {
            // Set preserva a ordem de inserção: o primeiro é o mais velho.
            this.seen.delete(this.seen.values().next().value as string);
        }
        return true;
    }

    private handle(data: string): void {
        let msg: unknown;
        try {
            msg = JSON.parse(data);
        } catch {
            return;
        }
        if (!Array.isArray(msg) || msg[0] !== "EVENT" || msg[1] !== SUB_ID) return;

        const event = msg[2] as NostrEvent;
        if (typeof event?.id !== "string" || !this.remember(event.id)) return;
        if (event.kind !== this.opts.kind) return;
        // Só aceita tópico que pedimos: relay pode mandar o que quiser.
        const t = event.tags?.find?.(tag => tag?.[0] === "t")?.[1];
        if (!t || !this.topics.includes(t)) return;

        void verifyEvent(event).then(ok => {
            if (!ok) {
                // Falsificação com o mesmo id não pode bloquear o evento verdadeiro.
                this.seen.delete(event.id);
                return;
            }
            for (const l of this.listeners) {
                try {
                    l(event);
                } catch (err) {
                    console.error("[P2PShare] ouvinte de relay falhou", err);
                }
            }
        });
    }
}
