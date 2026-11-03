/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { finalizeEvent, type NostrEvent } from "./event";
import { RelayPool, type RelaySocket } from "./pool";
import { generateSecretKey } from "./schnorr";

class FakeSocket implements RelaySocket {
    sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((d: string) => void) | null = null;
    onclose: (() => void) | null = null;
    closed = false;
    constructor(public url: string) { }
    send(d: string) { this.sent.push(JSON.parse(d)); }
    close() { this.closed = true; }
    open() { this.onopen?.(); }
    push(msg: unknown) { this.onmessage?.(JSON.stringify(msg)); }
    drop() { this.onclose?.(); }
}

const KIND = 25050;
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const pools: RelayPool[] = [];

function make(urls = ["wss://a", "wss://b"], opts = {}) {
    const sockets: FakeSocket[] = [];
    const pool = new RelayPool(urls, url => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
    }, { kind: KIND, reconnectBaseMs: 10, ...opts });
    pools.push(pool);
    return { pool, sockets };
}

async function event(topic: string): Promise<NostrEvent> {
    return finalizeEvent({ kind: KIND, tags: [["t", topic]], content: "x" }, generateSecretKey());
}

afterEach(() => {
    for (const p of pools.splice(0)) p.close();
});

describe("RelayPool", () => {
    it("inscreve nos tópicos ao abrir e ao trocar", () => {
        const { pool, sockets } = make();
        pool.setTopics(["t1"]);
        sockets[0].open();
        const req = sockets[0].sent[0] as any[];
        assert.equal(req[0], "REQ");
        assert.deepEqual(req[2]["#t"], ["t1"]);
        assert.deepEqual(req[2].kinds, [KIND]);

        pool.setTopics(["t1", "t2"]);
        assert.deepEqual((sockets[0].sent[1] as any[])[2]["#t"], ["t1", "t2"]);
        // Mesma lista não reinscreve.
        pool.setTopics(["t2", "t1"]);
        assert.equal(sockets[0].sent.length, 2);
    });

    it("publica em todos os relays abertos", async () => {
        const { pool, sockets } = make();
        sockets[0].open();
        sockets[1].open();
        pool.publish(await event("t1"));
        assert.ok(sockets.every(s => s.sent.some(m => (m as any[])[0] === "EVENT")));
    });

    it("entrega uma vez o mesmo evento vindo de relays diferentes", async () => {
        const { pool, sockets } = make();
        pool.setTopics(["t1"]);
        sockets.forEach(s => s.open());
        const got: string[] = [];
        pool.onEvent(e => got.push(e.id));
        const e = await event("t1");
        sockets[0].push(["EVENT", "p2ps", e]);
        sockets[1].push(["EVENT", "p2ps", e]);
        await tick();
        assert.deepEqual(got, [e.id]);
    });

    it("descarta assinatura inválida, tópico não pedido e o próprio eco", async () => {
        const { pool, sockets } = make(["wss://a"]);
        pool.setTopics(["t1"]);
        sockets[0].open();
        const got: string[] = [];
        pool.onEvent(e => got.push(e.id));

        const forged = { ...(await event("t1")), content: "adulterado" };
        sockets[0].push(["EVENT", "p2ps", forged]);
        sockets[0].push(["EVENT", "p2ps", await event("outro")]);
        const mine = await event("t1");
        pool.publish(mine);
        sockets[0].push(["EVENT", "p2ps", mine]);
        await tick();
        assert.deepEqual(got, []);
    });

    it("reconecta quando o relay cai", async () => {
        const { sockets } = make(["wss://a"]);
        sockets[0].open();
        sockets[0].drop();
        await tick(50);
        assert.equal(sockets.length, 2);
        assert.equal(sockets[1].url, "wss://a");
    });
});
