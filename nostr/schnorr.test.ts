/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateSecretKey, getPublicKey, sign, verify } from "./schnorr";

const Z32 = "00".repeat(32);

describe("schnorr (BIP340)", () => {
    it("vetor oficial 0: chave pública e assinatura", async () => {
        const sk = "00".repeat(31) + "03";
        const pk = getPublicKey(sk);
        assert.equal(pk.toUpperCase(), "F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9");

        const sig = await sign(Z32, sk, Z32);
        assert.equal(
            sig.toUpperCase(),
            "E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA8215" +
            "25F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0"
        );
        assert.equal(await verify(sig, Z32, pk), true);
    });

    it("assina e verifica com chave aleatória", async () => {
        const sk = generateSecretKey();
        const pk = getPublicKey(sk);
        const msg = "ab".repeat(32);
        const sig = await sign(msg, sk);
        assert.equal(await verify(sig, msg, pk), true);
    });

    it("rejeita mensagem, assinatura ou chave adulteradas", async () => {
        const sk = generateSecretKey();
        const pk = getPublicKey(sk);
        const msg = "cd".repeat(32);
        const sig = await sign(msg, sk);

        assert.equal(await verify(sig, "ce" + msg.slice(2), pk), false);
        assert.equal(await verify((sig[0] === "0" ? "1" : "0") + sig.slice(1), msg, pk), false);
        assert.equal(await verify(sig, msg, getPublicKey(generateSecretKey())), false);
        assert.equal(await verify("zz", msg, pk), false);
    });
});
