/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isNewer, looksLikePlugin,parseMetaVersion } from "./updater";

describe("parseMetaVersion", () => {
    it("lê a versão do cabeçalho do BetterDiscord", () => {
        const header = "/**\n * @name P2PShare\n * @version 1.2.3\n */\nmodule.exports = 1;";
        assert.equal(parseMetaVersion(header), "1.2.3");
    });

    it("tolera espaçamento diferente", () => {
        assert.equal(parseMetaVersion("/**\n@version    2.0.0\n*/"), "2.0.0");
    });

    it("devolve null quando não há versão", () => {
        assert.equal(parseMetaVersion("/**\n * @name P2PShare\n */"), null);
    });

    it("devolve null em conteúdo vazio", () => {
        assert.equal(parseMetaVersion(""), null);
    });
});

describe("isNewer", () => {
    it("reconhece versão maior", () => {
        assert.equal(isNewer("1.0.1", "1.0.0"), true);
        assert.equal(isNewer("1.1.0", "1.0.9"), true);
        assert.equal(isNewer("2.0.0", "1.9.9"), true);
    });

    it("reconhece versão igual ou menor", () => {
        assert.equal(isNewer("1.0.0", "1.0.0"), false);
        assert.equal(isNewer("1.0.0", "1.0.1"), false);
        assert.equal(isNewer("1.9.9", "2.0.0"), false);
    });

    it("compara número a número, não texto", () => {
        // "10" < "9" em ordem alfabética; aqui tem que ser maior
        assert.equal(isNewer("1.10.0", "1.9.0"), true);
    });

    it("trata versões de tamanhos diferentes", () => {
        assert.equal(isNewer("1.1", "1.0.9"), true);
        assert.equal(isNewer("1.0", "1.0.0"), false);
    });

    it("recusa versões ilegíveis em vez de arriscar", () => {
        assert.equal(isNewer("abc", "1.0.0"), false);
        assert.equal(isNewer("", "1.0.0"), false);
    });
});

describe("looksLikePlugin", () => {
    // Corpo com tamanho realista: o plugin de verdade tem dezenas de KB, e a
    // checagem recusa arquivos curtos demais para serem o plugin.
    const valido =
        "/**\n * @name P2PShare\n * @version 9.9.9\n */\n" +
        "class X {}\n".repeat(120) +
        "module.exports = X;\n";

    it("aceita um plugin plausível", () => {
        assert.equal(looksLikePlugin(valido, "P2PShare"), true);
    });

    it("recusa página de erro do host", () => {
        assert.equal(looksLikePlugin("<!DOCTYPE html><h1>404</h1>", "P2PShare"), false);
    });

    it("recusa arquivo de outro plugin", () => {
        assert.equal(looksLikePlugin(valido.replace("P2PShare", "Outro"), "P2PShare"), false);
    });

    it("recusa arquivo sem module.exports", () => {
        assert.equal(
            looksLikePlugin("/**\n * @name P2PShare\n * @version 9.9.9\n */\n", "P2PShare"),
            false
        );
    });

    it("recusa conteúdo suspeitosamente curto", () => {
        assert.equal(looksLikePlugin("/**@name P2PShare*/module.exports={}", "P2PShare"), false);
    });
});
