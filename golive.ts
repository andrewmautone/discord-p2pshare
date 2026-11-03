/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Regras do botão nativo "Compartilhar tela" do Discord.
 *
 * O P2PShare não cria botão próprio na chamada: ele assume o clique do botão
 * nativo. Estas regras decidem quando o clique é nosso e quando segue para o
 * Go Live do Discord. Sem nada do Discord aqui, para dar para testar fora.
 */

/** O que o botão nativo faz quando clicado sem modificador. */
export type NativeButtonMode = "p2p" | "discord";

/**
 * O rótulo diz "compartilhar a tela"?
 *
 * Exige intenção de COMPARTILHAR: só "tela" casaria com "Tela cheia". E
 * descarta os outros "compartilhar" da chamada (convite, link, atividade).
 */
export function isShareScreenLabel(label: string): boolean {
    const l = label.toLowerCase();
    if (!/compartilh|share/.test(l)) return false;
    return !/cheia|fullscreen|convite|invite|link|atividade|activit/.test(l);
}

export interface ClickContext {
    mode: NativeButtonMode;
    /** Clique disparado por nós mesmos para abrir o Go Live. */
    bypass: boolean;
    shiftKey: boolean;
    /** Já estou transmitindo via P2P. */
    p2pActive: boolean;
    /** Rótulo que o Discord deu ao botão (o original, não o que pintamos). */
    nativeLabel: string;
}

/** O clique no botão nativo vai para o P2PShare? */
export function shouldIntercept(ctx: ClickContext): boolean {
    if (ctx.bypass || ctx.mode !== "p2p") return false;
    // Shift+clique: atalho para o Go Live original.
    if (ctx.shiftKey) return false;
    // Transmitindo via P2P, o botão abre o nosso menu (parar, qualidade).
    if (ctx.p2pActive) return true;
    // Com o Go Live do Discord no ar o rótulo vira "parar": esse clique é
    // dele, senão não haveria como encerrar a transmissão nativa.
    return isShareScreenLabel(ctx.nativeLabel);
}
