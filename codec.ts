/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ZW_DELIM, ZW_DIGITS } from "./constants";

const DIGIT_INDEX = new Map(ZW_DIGITS.map((c, i) => [c, i] as const));

/** Codifica texto em caracteres invisíveis: 1 byte UTF-8 vira 4 caracteres. */
export function encodeZeroWidth(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let out = "";

    for (const byte of bytes) {
        out += ZW_DIGITS[(byte >> 6) & 3];
        out += ZW_DIGITS[(byte >> 4) & 3];
        out += ZW_DIGITS[(byte >> 2) & 3];
        out += ZW_DIGITS[byte & 3];
    }

    return out;
}

/** Inverso de encodeZeroWidth. Entrada malformada lança. */
export function decodeZeroWidth(zw: string): string {
    const chars = [...zw];
    if (chars.length % 4 !== 0) throw new Error("comprimento zero-width inválido");

    const bytes = new Uint8Array(chars.length / 4);
    for (let i = 0; i < bytes.length; i++) {
        let byte = 0;
        for (let j = 0; j < 4; j++) {
            const digit = DIGIT_INDEX.get(chars[i * 4 + j]);
            if (digit === undefined) throw new Error("caractere zero-width inválido");
            byte = (byte << 2) | digit;
        }
        bytes[i] = byte;
    }

    return new TextDecoder().decode(bytes);
}

/** Anexa um payload JSON invisível ao fim de um texto legível. */
export function embedPayload(visible: string, payload: unknown): string {
    return visible + ZW_DELIM + encodeZeroWidth(JSON.stringify(payload)) + ZW_DELIM;
}

/** Extrai o payload embutido. Devolve null se não houver ou estiver corrompido. */
export function extractPayload<T>(content: string): T | null {
    const start = content.indexOf(ZW_DELIM);
    if (start === -1) return null;

    const end = content.indexOf(ZW_DELIM, start + 1);
    if (end === -1) return null;

    try {
        return JSON.parse(decodeZeroWidth(content.slice(start + 1, end))) as T;
    } catch {
        return null;
    }
}

export type HandshakeKind = "offer" | "answer";

export interface HandshakeName {
    sessionId: string;
    kind: HandshakeKind;
    targetUserId: string;
}

export function formatHandshakeName(n: HandshakeName): string {
    return `p2p.${n.sessionId}.${n.kind}.${n.targetUserId}.txt`;
}

/** Lê o roteamento a partir do nome do anexo. Devolve null se não for nosso. */
export function parseHandshakeName(filename: string): HandshakeName | null {
    const parts = filename.split(".");
    if (parts.length !== 5) return null;

    const [prefix, sessionId, kind, targetUserId, ext] = parts;
    if (prefix !== "p2p" || ext !== "txt") return null;
    if (kind !== "offer" && kind !== "answer") return null;
    if (!sessionId || !targetUserId) return null;

    return { sessionId, kind, targetUserId };
}

export function newSessionId(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => (b % 36).toString(36)).join("");
}
