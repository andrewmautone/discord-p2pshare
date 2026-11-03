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

/**
 * Seta "para a direita" do ícone de compartilhar tela do Discord atual.
 *
 * No painel de voz o botão não tem `aria-label`: o texto só existe no
 * tooltip, montado no hover. O ícone é o que sobra para reconhecê-lo, e esta
 * seta aparece tanto na versão normal quanto na "indisponível".
 */
export const SHARE_ARROW_PATH = "1.4l3-3a1 1 0 0 0 0-1.4l-3-3";

/** Círculo cortado que o Discord sobrepõe ao ícone quando o recurso está bloqueado. */
export const BLOCKED_BADGE_PATH = "M15.46 15.46a5 5 0 0 1 7.07 0";

/** Algum `d` de path é do ícone de compartilhar tela? */
export function isShareScreenIcon(paths: string[]): boolean {
    return paths.some(d => d.includes(SHARE_ARROW_PATH) || d.startsWith("M2 4.5C2 3.397"));
}

/** O ícone tem o selo de "indisponível" (círculo cortado)? */
export function isBlockedIcon(paths: string[]): boolean {
    return paths.some(d => d.startsWith(BLOCKED_BADGE_PATH));
}

/**
 * O botão nativo, agora, está oferecendo "compartilhar tela"?
 *
 * Pelo rótulo quando há um (barra da chamada, tooltip); sem rótulo, pelo
 * ícone. Com o Go Live do Discord no ar o rótulo vira "parar" e o ícone
 * perde a seta, e então o botão não é mais "compartilhar".
 */
export function offersShare(label: string, paths: string[]): boolean {
    return label ? isShareScreenLabel(label) : isShareScreenIcon(paths);
}

export interface ClickContext {
    mode: NativeButtonMode;
    /** Clique disparado por nós mesmos para abrir o Go Live. */
    bypass: boolean;
    shiftKey: boolean;
    /** Já estou transmitindo via P2P. */
    p2pActive: boolean;
    /** O botão nativo está oferecendo "compartilhar tela" (ver `offersShare`). */
    nativeOffersShare: boolean;
}

/** O clique no botão nativo vai para o P2PShare? */
export function shouldIntercept(ctx: ClickContext): boolean {
    if (ctx.bypass || ctx.mode !== "p2p") return false;
    // Shift+clique: atalho para o Go Live original.
    if (ctx.shiftKey) return false;
    // Transmitindo via P2P, o botão abre o nosso menu (parar, qualidade).
    if (ctx.p2pActive) return true;
    // Com o Go Live do Discord no ar o botão vira "parar": esse clique é
    // dele, senão não haveria como encerrar a transmissão nativa. Já o
    // "indisponível" (sem permissão de vídeo) é nosso: o P2P não depende dela.
    return ctx.nativeOffersShare;
}
