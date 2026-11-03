/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { bytesToHex, hexToBytes, sha256 } from "./schnorr";

/**
 * "Sala" de um canal de voz nos relays públicos.
 *
 * Tópico e chave saem do id do canal, com rótulos diferentes: o relay só vê
 * um hash e um texto cifrado. Quem conhece o id do canal (os membros do
 * servidor) consegue ler — foi a regra pedida: todo mundo do servidor com o
 * plugin vê quem está transmitindo, mesmo fora da chamada.
 */

const VERSION = "p2pshare-v1";
const enc = new TextEncoder();
const dec = new TextDecoder();

/** Valor da tag `t` do canal. Determinístico e sem relação legível com o id. */
export async function roomTopic(channelId: string): Promise<string> {
    return bytesToHex(await sha256(enc.encode(`${VERSION}:topic:${channelId}`)));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function roomKey(channelId: string): Promise<CryptoKey> {
    let key = keyCache.get(channelId);
    if (!key) {
        key = (async () => {
            const raw = await sha256(enc.encode(`${VERSION}:key:${channelId}`));
            return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
        })();
        keyCache.set(channelId, key);
    }
    return key;
}

function toBase64(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

function fromBase64(text: string): Uint8Array {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

/** JSON → base64(iv ‖ AES-GCM). */
export async function sealRoom(channelId: string, payload: unknown): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await roomKey(channelId),
        enc.encode(JSON.stringify(payload))
    );
    const out = new Uint8Array(12 + data.byteLength);
    out.set(iv);
    out.set(new Uint8Array(data), 12);
    return toBase64(out);
}

/** null para qualquer coisa que não abra com a chave do canal. */
export async function openRoom(channelId: string, content: string): Promise<unknown> {
    try {
        const bytes = fromBase64(content);
        if (bytes.length < 13) return null;
        const plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: bytes.slice(0, 12) },
            await roomKey(channelId),
            bytes.slice(12)
        );
        return JSON.parse(dec.decode(plain));
    } catch {
        return null;
    }
}

export { bytesToHex, hexToBytes };
