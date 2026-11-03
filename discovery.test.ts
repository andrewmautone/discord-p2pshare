/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { Discovery, type PoolLike } from "./discovery";
import { finalizeEvent, type NostrEvent, P2PSHARE_KIND } from "./nostr/event";
import { roomTopic, sealRoom } from "./nostr/room";
import { generateSecretKey } from "./nostr/schnorr";

/** Relay em memória: entrega a todos os pools inscritos no tópico. */
class Bus {
    pools = new Set<FakePool>();
    deliver(e: NostrEvent, from: FakePool) {
        const t = e.tags.find(x => x[0] === "t")?.[1];
        for (const p of this.pools) if (p !== from && t && p.topics.includes(t)) p.emit(e);
    }
}

class FakePool implements PoolLike {
    topics: string[] = [];
    published: NostrEvent[] = [];
    private listeners = new Set<(e: NostrEvent) => void>();
    constructor(private bus: Bus) { bus.pools.add(this); }
    setTopics(t: readonly string[]) { this.topics = [...t]; }
    publish(e: NostrEvent) { this.published.push(e); this.bus.deliver(e, this); }
    onEvent(l: (e: NostrEvent) => void) { this.listeners.add(l); return () => this.listeners.delete(l); }
    emit(e: NostrEvent) { for (const l of this.listeners) l(e); }
}

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const CH = "1141498155561664692";
const open: Discovery[] = [];

function client(bus: Bus, id: string, extra: Partial<ConstructorParameters<typeof Discovery>[1]> = {}) {
    const pool = new FakePool(bus);
    const d = new Discovery(pool, { me: () => ({ id, name: `user${id}` }), ...extra });
    open.push(d);
    return { d, pool };
}

afterEach(() => {
    for (const d of open.splice(0)) d.close();
});

describe("Discovery", () => {
    it("quem olha o canal vê o aviso ao vivo, com nome e chave", async () => {
        const bus = new Bus();
        const a = client(bus, "1");
        const b = client(bus, "2");
        await b.d.watch([CH]);

        a.d.startLive(CH, "sess1");
        await tick(80);

        const live = b.d.live();
        assert.equal(live.length, 1);
        assert.equal(live[0].userId, "1");
        assert.equal(live[0].name, "user1");
        assert.equal(live[0].channelId, CH);
        assert.equal(live[0].pubkey, a.d.pubkey);
    });

    it("quem olha outro canal não vê nada", async () => {
        const bus = new Bus();
        const a = client(bus, "1");
        const b = client(bus, "2");
        await b.d.watch(["999"]);
        a.d.startLive(CH, "sess1");
        await tick(80);
        assert.deepEqual(b.d.live(), []);
    });

    it("o relay só vê hash e texto cifrado", async () => {
        const bus = new Bus();
        const a = client(bus, "1");
        a.d.startLive(CH, "sess1");
        await tick(80);
        const ev = a.pool.published[0];
        assert.ok(!JSON.stringify(ev).includes(CH));
        assert.ok(!ev.content.includes("sess1"));
        assert.equal(ev.tags[0][1], await roomTopic(CH));
    });

    it("parar avisa o fim e o aviso some na hora", async () => {
        const bus = new Bus();
        const a = client(bus, "1");
        const b = client(bus, "2");
        await b.d.watch([CH]);
        const stop = a.d.startLive(CH, "sess1");
        await tick(80);
        assert.equal(b.d.live().length, 1);
        stop();
        await tick(80);
        assert.equal(b.d.live().length, 0);
    });

    it("sem renovação o aviso expira sozinho", async () => {
        const bus = new Bus();
        let now = Date.now();
        const a = client(bus, "1", { renewMs: 60_000 });
        const b = client(bus, "2", { now: () => now });
        await b.d.watch([CH]);
        a.d.startLive(CH, "sess1");
        await tick(80);
        assert.equal(b.d.live().length, 1);

        now += 16_000;
        await tick(1_100); // relógio de limpeza roda a cada segundo
        assert.equal(b.d.live().length, 0);
    });

    it("offer/answer chegam só ao destinatário, pela sala do canal", async () => {
        const bus = new Bus();
        const a = client(bus, "1");
        const b = client(bus, "2");
        const c = client(bus, "3");
        await b.d.watch([CH]);
        await c.d.watch([CH]);

        const gotA: string[] = [], gotB: string[] = [], gotC: string[] = [];
        a.d.onSignal(s => gotA.push(`${s.kind}:${s.fromUserId}:${s.sdp}`));
        b.d.onSignal(s => gotB.push(`${s.kind}:${s.fromUserId}:${s.sdp}`));
        c.d.onSignal(s => gotC.push(s.kind));

        a.d.startLive(CH, "sess1");
        await tick(80);
        await b.d.sendSignal(CH, "sess1", "offer", "1", "OFFER-SDP");
        await tick(80);
        await a.d.sendSignal(CH, "sess1", "answer", "2", "ANSWER-SDP");
        await tick(80);

        assert.deepEqual(gotA, ["offer:2:OFFER-SDP"]);
        assert.deepEqual(gotB, ["answer:1:ANSWER-SDP"]);
        assert.deepEqual(gotC, []);
    });

    it("offer para sessão que não estou transmitindo é ignorado", async () => {
        const bus = new Bus();
        const a = client(bus, "1");
        const b = client(bus, "2");
        const got: string[] = [];
        a.d.onSignal(s => got.push(s.kind));
        a.d.startLive(CH, "sess1");
        await b.d.watch([CH]);
        await b.d.sendSignal(CH, "outra", "offer", "1", "x");
        await tick(80);
        assert.deepEqual(got, []);
    });

    it("answer de outra chave (impostor) é ignorado, e ele não sequestra o aviso", async () => {
        const bus = new Bus();
        const a = client(bus, "1");
        const b = client(bus, "2");
        const evil = client(bus, "1"); // finge ser o usuário 1
        await b.d.watch([CH]);
        await evil.d.watch([CH]);
        const got: string[] = [];
        b.d.onSignal(s => got.push(s.sdp));

        a.d.startLive(CH, "sess1");
        await tick(80);
        await evil.d.sendSignal(CH, "sess1", "answer", "2", "FALSO");
        await tick(80);
        assert.deepEqual(got, []);
        assert.equal(b.d.live()[0].pubkey, a.d.pubkey);
    });

    it("descarta evento velho (replay) e cifrado com outra chave", async () => {
        const bus = new Bus();
        const b = client(bus, "2");
        await b.d.watch([CH]);
        const sk = generateSecretKey();
        const topic = await roomTopic(CH);

        const old = await finalizeEvent({
            kind: P2PSHARE_KIND, tags: [["t", topic]],
            content: await sealRoom(CH, { v: 1, t: "live", s: "x", u: "9", n: "n", ttl: 15000 }),
            created_at: Math.floor(Date.now() / 1000) - 3600
        }, sk);
        const wrongKey = await finalizeEvent({
            kind: P2PSHARE_KIND, tags: [["t", topic]],
            content: await sealRoom("outro-canal", { v: 1, t: "live", s: "y", u: "9", n: "n", ttl: 15000 })
        }, sk);

        await b.d.handle(old);
        await b.d.handle(wrongKey);
        assert.deepEqual(b.d.live(), []);
    });
});
