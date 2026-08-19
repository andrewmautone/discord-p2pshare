/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toBytes } from "./binary";

describe("toBytes", () => {
    it("devolve os bytes de um Uint8Array sem mexer", () => {
        const src = new Uint8Array([0, 127, 128, 255]);
        assert.deepEqual([...toBytes(src)], [0, 127, 128, 255]);
    });

    // O fs do BetterDiscord devolve texto no lugar de bytes. Lido como
    // latin1, cada caractere é um byte — a conversão precisa ser exata,
    // inclusive acima de 127, onde o UTF-8 destruiria o conteúdo.
    it("converte texto latin1 byte a byte", () => {
        const texto = String.fromCharCode(0, 127, 128, 255);
        assert.deepEqual([...toBytes(texto)], [0, 127, 128, 255]);
    });

    it("preserva o comprimento de um binário com bytes altos", () => {
        const bytes = new Uint8Array(256).map((_, i) => i);
        const comoTexto = String.fromCharCode(...bytes);

        assert.equal(toBytes(comoTexto).length, 256);
        assert.deepEqual([...toBytes(comoTexto)], [...bytes]);
    });
});
