/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    decodeZeroWidth,
    embedPayload,
    encodeZeroWidth,
    extractPayload,
    formatHandshakeName,
    newSessionId,
    parseHandshakeName
} from "./codec";
import { ZW_CODEPOINTS, ZW_DELIM } from "./constants";

/** Só caracteres do alfabeto zero-width, montado a partir da constante. */
const ONLY_ZW = new RegExp(`^[${ZW_CODEPOINTS.map(c => `\\u{${c.toString(16)}}`).join("")}]+$`, "u");

describe("zero-width codec", () => {
    it("faz roundtrip de ascii", () => {
        assert.equal(decodeZeroWidth(encodeZeroWidth("hello")), "hello");
    });

    it("faz roundtrip de acentos e emoji", () => {
        const s = "ação 🔴 ünïcode";
        assert.equal(decodeZeroWidth(encodeZeroWidth(s)), s);
    });

    it("faz roundtrip de string vazia", () => {
        assert.equal(decodeZeroWidth(encodeZeroWidth("")), "");
    });

    it("produz apenas caracteres invisíveis", () => {
        assert.match(encodeZeroWidth("abc"), ONLY_ZW);
    });

    it("usa 4 caracteres por byte", () => {
        // "abc" = 3 bytes UTF-8
        assert.equal(encodeZeroWidth("abc").length, 12);
    });

    it("rejeita comprimento que não é múltiplo de 4", () => {
        assert.throws(() => decodeZeroWidth(String.fromCodePoint(ZW_CODEPOINTS[0])));
    });

    it("rejeita caractere fora do alfabeto", () => {
        assert.throws(() => decodeZeroWidth("abcd"));
    });
});

describe("payload embutido", () => {
    it("preserva o texto visível", () => {
        const msg = embedPayload("🔴 transmitindo", { v: 1, s: "abc12345" });
        assert.ok(msg.startsWith("🔴 transmitindo"));
    });

    it("recupera o payload", () => {
        const msg = embedPayload("oi", { v: 1, s: "abc12345" });
        assert.deepEqual(extractPayload(msg), { v: 1, s: "abc12345" });
    });

    it("devolve null quando não há payload", () => {
        assert.equal(extractPayload("mensagem normal"), null);
    });

    it("devolve null quando o payload é JSON inválido", () => {
        const broken = "oi" + ZW_DELIM + encodeZeroWidth("{nao e json") + ZW_DELIM;
        assert.equal(extractPayload(broken), null);
    });

    it("devolve null quando o delimitador não fecha", () => {
        assert.equal(extractPayload("oi" + ZW_DELIM + encodeZeroWidth("{}")), null);
    });
});

describe("nome de handshake", () => {
    it("faz roundtrip", () => {
        const n = { sessionId: "abc12345", kind: "offer" as const, targetUserId: "123456789" };
        assert.deepEqual(parseHandshakeName(formatHandshakeName(n)), n);
    });

    it("formata no padrão esperado", () => {
        const name = formatHandshakeName({ sessionId: "abc12345", kind: "answer", targetUserId: "42" });
        assert.equal(name, "p2p.abc12345.answer.42.txt");
    });

    it("rejeita nome de outro arquivo", () => {
        assert.equal(parseHandshakeName("foto.png"), null);
    });

    it("rejeita kind desconhecido", () => {
        assert.equal(parseHandshakeName("p2p.abc12345.candidate.42.txt"), null);
    });

    it("rejeita número errado de segmentos", () => {
        assert.equal(parseHandshakeName("p2p.abc12345.offer.txt"), null);
    });

    it("rejeita prefixo errado", () => {
        assert.equal(parseHandshakeName("xyz.abc12345.offer.42.txt"), null);
    });
});

describe("newSessionId", () => {
    it("tem 8 caracteres alfanuméricos", () => {
        assert.match(newSessionId(), /^[a-z0-9]{8}$/);
    });

    it("não repete em 100 chamadas", () => {
        const ids = new Set(Array.from({ length: 100 }, () => newSessionId()));
        assert.equal(ids.size, 100);
    });
});
