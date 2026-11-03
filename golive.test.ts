/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    isBlockedIcon,
    isShareScreenIcon,
    isShareScreenLabel,
    offersShare,
    shouldIntercept,
    type ClickContext
} from "./golive";

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
    nativeOffersShare: true
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
    assert.equal(shouldIntercept({ ...base, nativeOffersShare: false }), false);
});

test("transmitindo via P2P, o clique abre o nosso menu", () => {
    assert.equal(shouldIntercept({ ...base, p2pActive: true, nativeOffersShare: false }), true);
});

// Paths reais do painel de voz do Discord (03/11/2026), botao "indisponivel".
const BLOCKED = "M15.46 15.46a5 5 0 0 1 7.07 0 5 5 0 0 1-7.07 7.07 5 5 0 0 1 0-7.07Zm2.25 6.25a3 3 0 0 0 4-4l-4 4Zm2.58-5.42a3 3 0 0 0-4 4l4-4Z";
const SCREEN_ARROW = "M19 2a3 3 0 0 1 3 3v6.88c0 .37-.38.61-.73.5a6.99 6.99 0 0 0-8.3 3.06c-.2.33-.54.56-.93.56H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3h14Zm-4.3 2.3a1 1 0 1 0-1.4 1.4L14.58 7H13a6 6 0 0 0-6 6 1 1 0 1 0 2 0 4 4 0 0 1 4-4h1.59l-1.3 1.3a1 1 0 1 0 1.42 1.4l3-3a1 1 0 0 0 0-1.4l-3-3Z";
const CAMERA = "M15 4a3 3 0 0 1 3 3v2.12a1 1 0 0 1 .55-.9l3-1.5a1 1 0 0 1 1.45.9v4.68c0 .4-.46.65-.82.46a7 7 0 0 0-10.16 6.66c.01.31-.22.58-.52.58H4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h11Z";

test("reconhece o botao de tela sem rotulo pelo icone, inclusive o indisponivel", () => {
    assert.equal(isShareScreenIcon([BLOCKED, SCREEN_ARROW]), true);
    assert.equal(isBlockedIcon([BLOCKED, SCREEN_ARROW]), true);
});

test("a camera bloqueada nao e' o botao de tela", () => {
    assert.equal(isShareScreenIcon([BLOCKED, CAMERA]), false);
});

test("o tooltip 'indisponivel' ainda e' compartilhar tela", () => {
    assert.equal(offersShare("Compartilhamento de tela indisponível", []), true);
});

test("sem rotulo, decide pelo icone", () => {
    assert.equal(offersShare("", [SCREEN_ARROW]), true);
    assert.equal(offersShare("", [CAMERA]), false);
});
