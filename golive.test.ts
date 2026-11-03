/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isShareScreenLabel, shouldIntercept, type ClickContext } from "./golive";

test("reconhece o botão de compartilhar tela em pt-BR e inglês", () => {
    assert.equal(isShareScreenLabel("Compartilhar sua tela"), true);
    assert.equal(isShareScreenLabel("Share Your Screen"), true);
});

test("não confunde com outros botões da chamada", () => {
    for (const label of [
        "Tela cheia", "Fullscreen", "Compartilhar convite", "Copiar link",
        "Compartilhar atividade", "Share Activity", "Parar de transmitir",
        "Stop Streaming", "Desativar microfone", ""
    ]) {
        assert.equal(isShareScreenLabel(label), false, label);
    }
});

const base: ClickContext = {
    mode: "p2p",
    bypass: false,
    shiftKey: false,
    p2pActive: false,
    nativeLabel: "Compartilhar sua tela"
};

test("clique simples abre o P2PShare", () => {
    assert.equal(shouldIntercept(base), true);
});

test("Shift+clique vai para o Go Live original", () => {
    assert.equal(shouldIntercept({ ...base, shiftKey: true }), false);
});

test("modo Discord não intercepta nada", () => {
    assert.equal(shouldIntercept({ ...base, mode: "discord" }), false);
    assert.equal(shouldIntercept({ ...base, mode: "discord", p2pActive: true }), false);
});

test("clique que nós mesmos disparamos para abrir o Go Live passa", () => {
    assert.equal(shouldIntercept({ ...base, bypass: true }), false);
});

test("com Go Live do Discord no ar, o botão de parar continua dele", () => {
    assert.equal(shouldIntercept({ ...base, nativeLabel: "Parar de transmitir" }), false);
});

test("transmitindo via P2P, o clique abre o nosso menu", () => {
    assert.equal(shouldIntercept({ ...base, p2pActive: true, nativeLabel: "qualquer" }), true);
});
