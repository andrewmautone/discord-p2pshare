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
    parseHandshakeBody
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
