/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    beaconContent,
    handshakeBody,
    handshakeMarker,
    parseBeacon,
    parseHandshakeBody,
    selectBeacons
} from "./beacon";
import { embedPayload } from "./codec";

function message(overrides: Record<string, unknown> = {}) {
    return {
        id: "msg1",
        channel_id: "chan1",
        content: beaconContent("abc12345", "Andrew"),
        author: { id: "user1", username: "Andrew" },
        ...overrides
    };
}

describe("beaconContent", () => {
    it("mostra o nome de quem transmite", () => {
        assert.ok(beaconContent("abc12345", "Andrew").includes("Andrew"));
    });

    it("inclui o link de instalação", () => {
        assert.match(beaconContent("abc12345", "Andrew"), /https?:\/\//);
    });

    it("leva direto ao instalador, sem obrigar a cacar o download", () => {
        assert.match(beaconContent("abc12345", "Andrew"), /P2PShare-Setup\.exe/);
    });

    it("fala tambem com quem ja tem o plugin", () => {
        assert.match(beaconContent("abc12345", "Andrew"), /AO VIVO/);
    });
});

describe("parseBeacon", () => {
    it("lê um beacon válido", () => {
        assert.deepEqual(parseBeacon(message()), {
            messageId: "msg1",
            channelId: "chan1",
            sessionId: "abc12345",
            broadcasterId: "user1",
            broadcasterName: "Andrew"
        });
    });

    it("ignora mensagem comum", () => {
        assert.equal(parseBeacon(message({ content: "oi pessoal" })), null);
    });

    it("ignora payload de versão desconhecida", () => {
        const content = embedPayload("qualquer", { v: 99, s: "abc12345" });
        assert.equal(parseBeacon(message({ content })), null);
    });

    it("ignora payload sem sessionId", () => {
        const content = embedPayload("qualquer", { v: 1 });
        assert.equal(parseBeacon(message({ content })), null);
    });

    it("não confunde um marcador de handshake com beacon", () => {
        const content = handshakeMarker("abc12345", "offer");
        assert.equal(parseBeacon(message({ content })), null);
    });
});

describe("corpo do handshake", () => {
    it("faz roundtrip do sdp", () => {
        const parsed = parseHandshakeBody(handshakeBody("offer", "v=0\r\na=fake"));
        assert.deepEqual(parsed, { kind: "offer", sdp: "v=0\r\na=fake" });
    });

    it("rejeita json inválido", () => {
        assert.equal(parseHandshakeBody("{nao e json"), null);
    });

    it("rejeita versão desconhecida", () => {
        assert.equal(parseHandshakeBody(JSON.stringify({ v: 99, type: "offer", sdp: "x" })), null);
    });

    it("rejeita corpo sem sdp", () => {
        assert.equal(parseHandshakeBody(JSON.stringify({ v: 1, type: "offer" })), null);
    });

    it("rejeita tipo desconhecido", () => {
        assert.equal(parseHandshakeBody(JSON.stringify({ v: 1, type: "candidate", sdp: "x" })), null);
    });
});

describe("selectBeacons", () => {
    const own = message({ id: "meu", content: beaconContent("s-meu", "Andrew") });
    const alheio = message({
        id: "msg2",
        content: beaconContent("s-outro", "Bia"),
        author: { id: "user2", username: "Bia" }
    });

    it("acha o beacon no meio de mensagens comuns", () => {
        const found = selectBeacons([
            message({ id: "a", content: "bom dia" }),
            alheio,
            message({ id: "b", content: "alguém aí?" })
        ]);

        assert.deepEqual(found.map(b => b.sessionId), ["s-outro"]);
        assert.equal(found[0].messageId, "msg2");
        assert.equal(found[0].broadcasterName, "Bia");
    });

    it("preserva a ordem em que as mensagens chegaram", () => {
        const outro = message({
            id: "msg3",
            content: beaconContent("s-terceiro", "Caio"),
            author: { id: "user3", username: "Caio" }
        });

        assert.deepEqual(
            selectBeacons([alheio, outro]).map(b => b.sessionId),
            ["s-outro", "s-terceiro"]
        );
    });

    it("ignora meu próprio beacon", () => {
        assert.deepEqual(selectBeacons([own, alheio], { excludeAuthorId: "user1" }), [
            {
                messageId: "msg2",
                channelId: "chan1",
                sessionId: "s-outro",
                broadcasterId: "user2",
                broadcasterName: "Bia"
            }
        ]);
    });

    it("não repete beacon já conhecido", () => {
        assert.deepEqual(selectBeacons([alheio], { knownMessageIds: ["msg2"] }), []);
    });

    it("dedupa a mesma mensagem repetida no mesmo lote", () => {
        assert.equal(selectBeacons([alheio, alheio, alheio]).length, 1);
    });

    it("ignora handshake, que também traz payload invisível", () => {
        const hs = message({ id: "hs", content: handshakeMarker("s-outro", "offer") });
        assert.deepEqual(selectBeacons([hs]), []);
    });

    it("sobrevive a registro malformado sem perder os vizinhos", () => {
        const found = selectBeacons([
            null,
            undefined,
            {},
            { id: 7, content: beaconContent("s-num", "X"), channel_id: "c", author: { id: "u" } },
            { id: "sem-autor", content: beaconContent("s-x", "X"), channel_id: "c" },
            alheio
        ]);

        assert.deepEqual(found.map(b => b.sessionId), ["s-outro"]);
    });

    it("aceita channelId camelCase, como vem do store do Discord", () => {
        const [beacon] = selectBeacons([{
            id: "msg9",
            channelId: "chan9",
            content: beaconContent("s-camel", "Bia"),
            author: { id: "user2", username: "Bia" }
        }]);

        assert.equal(beacon.channelId, "chan9");
    });

    it("cai no id cru quando a mensagem não traz o nome do autor", () => {
        const [beacon] = selectBeacons([{
            id: "msg10",
            channel_id: "chan1",
            content: beaconContent("s-anon", "?"),
            author: { id: "user7" }
        }]);

        assert.equal(beacon.broadcasterName, "user7");
    });
});
