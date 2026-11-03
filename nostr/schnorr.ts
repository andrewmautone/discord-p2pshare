/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Assinatura Schnorr sobre secp256k1 (BIP340), o que o Nostr exige.
 *
 * Implementação mínima em BigInt para não puxar dependência: só gerar chave,
 * assinar e verificar. As chaves são descartáveis (uma por sessão do plugin) e
 * não protegem nada de valor — servem para os relays aceitarem os eventos e
 * para amarrar o handshake ao mesmo emissor do aviso.
 *
 * Módulo puro: usa só crypto.subtle (SHA-256) e crypto.getRandomValues.
 */

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

const mod = (a: bigint, m = P): bigint => {
    const r = a % m;
    return r >= 0n ? r : r + m;
};

function pow(base: bigint, exp: bigint, m = P): bigint {
    let result = 1n;
    base = mod(base, m);
    while (exp > 0n) {
        if (exp & 1n) result = (result * base) % m;
        base = (base * base) % m;
        exp >>= 1n;
    }
    return result;
}

const inv = (a: bigint): bigint => pow(a, P - 2n);

/** Ponto em coordenadas jacobianas; Z = 0 é o infinito. */
type J = [bigint, bigint, bigint];
const INF: J = [0n, 1n, 0n];

function dbl([x, y, z]: J): J {
    if (z === 0n || y === 0n) return INF;
    const ysq = mod(y * y);
    const s = mod(4n * x * ysq);
    const m = mod(3n * x * x);
    const nx = mod(m * m - 2n * s);
    const ny = mod(m * (s - nx) - 8n * ysq * ysq);
    const nz = mod(2n * y * z);
    return [nx, ny, nz];
}

function add(p: J, q: J): J {
    if (p[2] === 0n) return q;
    if (q[2] === 0n) return p;
    const [x1, y1, z1] = p;
    const [x2, y2, z2] = q;
    const z1z1 = mod(z1 * z1), z2z2 = mod(z2 * z2);
    const u1 = mod(x1 * z2z2), u2 = mod(x2 * z1z1);
    const s1 = mod(y1 * z2 * z2z2), s2 = mod(y2 * z1 * z1z1);
    if (u1 === u2) return s1 === s2 ? dbl(p) : INF;
    const h = mod(u2 - u1), r = mod(s2 - s1);
    const hh = mod(h * h), hhh = mod(h * hh);
    const v = mod(u1 * hh);
    const nx = mod(r * r - hhh - 2n * v);
    const ny = mod(r * (v - nx) - s1 * hhh);
    const nz = mod(h * z1 * z2);
    return [nx, ny, nz];
}

function mul(k: bigint, point: J): J {
    let r = INF;
    let q = point;
    while (k > 0n) {
        if (k & 1n) r = add(r, q);
        q = dbl(q);
        k >>= 1n;
    }
    return r;
}

/** Afim: [x, y], ou null para o infinito. */
function affine([x, y, z]: J): [bigint, bigint] | null {
    if (z === 0n) return null;
    const zi = inv(z), zi2 = mod(zi * zi);
    return [mod(x * zi2), mod(y * zi2 * zi)];
}

const G: J = [GX, GY, 1n];

function liftX(x: bigint): J | null {
    if (x >= P) return null;
    const c = mod(x * x * x + 7n);
    const y = pow(c, (P + 1n) / 4n);
    if (mod(y * y) !== c) return null;
    return [x, (y & 1n) === 0n ? y : P - y, 1n];
}

// ------------------------------------------------------------ bytes

export function hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error("hex inválido");
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
}

export function bytesToHex(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
}

const toBig = (b: Uint8Array): bigint => BigInt("0x" + (bytesToHex(b) || "0"));
const to32 = (n: bigint): Uint8Array => hexToBytes(n.toString(16).padStart(64, "0"));

function concat(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) {
        out.set(p, o);
        o += p.length;
    }
    return out;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

const tagCache = new Map<string, Uint8Array>();

async function taggedHash(tag: string, ...msgs: Uint8Array[]): Promise<Uint8Array> {
    let t = tagCache.get(tag);
    if (!t) {
        t = await sha256(new TextEncoder().encode(tag));
        tagCache.set(tag, t);
    }
    return sha256(concat(t, t, ...msgs));
}

// ------------------------------------------------------------ API

/** Chave privada aleatória de 32 bytes, em hex. */
export function generateSecretKey(): string {
    for (;;) {
        const sk = crypto.getRandomValues(new Uint8Array(32));
        const d = toBig(sk);
        if (d > 0n && d < N) return bytesToHex(sk);
    }
}

/** Chave pública x-only (32 bytes, hex), como o Nostr usa. */
export function getPublicKey(secretHex: string): string {
    const d = toBig(hexToBytes(secretHex));
    if (d <= 0n || d >= N) throw new Error("chave privada fora do intervalo");
    const pt = affine(mul(d, G))!;
    return bytesToHex(to32(pt[0]));
}

export async function sign(msgHex: string, secretHex: string, auxHex?: string): Promise<string> {
    const m = hexToBytes(msgHex);
    const d0 = toBig(hexToBytes(secretHex));
    if (d0 <= 0n || d0 >= N) throw new Error("chave privada fora do intervalo");

    const [px, py] = affine(mul(d0, G))!;
    const d = (py & 1n) === 0n ? d0 : N - d0;
    const aux = auxHex ? hexToBytes(auxHex) : crypto.getRandomValues(new Uint8Array(32));

    const t = to32(d ^ toBig(await taggedHash("BIP0340/aux", aux)));
    const pxb = to32(px);
    const k0 = mod(toBig(await taggedHash("BIP0340/nonce", t, pxb, m)), N);
    if (k0 === 0n) throw new Error("nonce nulo");

    const [rx, ry] = affine(mul(k0, G))!;
    const k = (ry & 1n) === 0n ? k0 : N - k0;
    const rxb = to32(rx);
    const e = mod(toBig(await taggedHash("BIP0340/challenge", rxb, pxb, m)), N);

    return bytesToHex(concat(rxb, to32(mod(k + e * d, N))));
}

export async function verify(sigHex: string, msgHex: string, pubHex: string): Promise<boolean> {
    try {
        const sig = hexToBytes(sigHex);
        const m = hexToBytes(msgHex);
        const pk = hexToBytes(pubHex);
        if (sig.length !== 64 || pk.length !== 32) return false;

        const P0 = liftX(toBig(pk));
        if (!P0) return false;

        const r = toBig(sig.slice(0, 32));
        const s = toBig(sig.slice(32));
        if (r >= P || s >= N) return false;

        const e = mod(toBig(await taggedHash("BIP0340/challenge", sig.slice(0, 32), pk, m)), N);
        const negP: J = [P0[0], P - P0[1], 1n];
        const R = affine(add(mul(s, G), mul(e, negP)));
        if (!R) return false;
        return (R[1] & 1n) === 0n && R[0] === r;
    } catch {
        return false;
    }
}
