/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { bytesToHex, getPublicKey, sha256, sign, verify } from "./schnorr";

/** Evento Nostr (NIP-01). */
export interface NostrEvent {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
}

/**
 * Tipo efêmero (faixa 20000–29999, NIP-16): o relay repassa a quem está
 * inscrito e não guarda. É o que queremos — o aviso é renovado a cada poucos
 * segundos e não deve sobrar em lugar nenhum.
 */
export const P2PSHARE_KIND = 25_050;

async function eventId(e: Omit<NostrEvent, "id" | "sig">): Promise<string> {
    const serial = JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
    return bytesToHex(await sha256(new TextEncoder().encode(serial)));
}

export async function finalizeEvent(
    template: { kind: number; tags: string[][]; content: string; created_at?: number; },
    secretKey: string
): Promise<NostrEvent> {
    const base = {
        pubkey: getPublicKey(secretKey),
        created_at: template.created_at ?? Math.floor(Date.now() / 1000),
        kind: template.kind,
        tags: template.tags,
        content: template.content
    };
    const id = await eventId(base);
    return { ...base, id, sig: await sign(id, secretKey) };
}

/** Confere forma, id e assinatura. Relay pode repassar lixo: nada passa sem isto. */
export async function verifyEvent(raw: unknown): Promise<boolean> {
    const e = raw as NostrEvent;
    if (!e || typeof e !== "object") return false;
    if (typeof e.id !== "string" || typeof e.pubkey !== "string" || typeof e.sig !== "string") return false;
    if (typeof e.created_at !== "number" || typeof e.kind !== "number") return false;
    if (typeof e.content !== "string" || !Array.isArray(e.tags)) return false;
    if (!e.tags.every(t => Array.isArray(t) && t.every(x => typeof x === "string"))) return false;

    if (await eventId(e) !== e.id) return false;
    return verify(e.sig, e.id, e.pubkey);
}
