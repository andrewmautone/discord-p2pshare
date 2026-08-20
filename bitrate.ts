/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { MAX_BITRATE, MIN_BITRATE } from "./constants";

/**
 * Divide o orçamento de upload entre os viewers conectados.
 *
 * Sem viewers, devolve o teto — o primeiro a conectar já entra na melhor
 * qualidade e só é rebaixado quando chega companhia.
 */
export function computePerPeerBitrate(budgetMbps: number, viewerCount: number): number {
    if (viewerCount <= 0) return MAX_BITRATE;

    const perPeer = (budgetMbps * 1_000_000) / viewerCount;
    return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, perPeer)));
}

/**
 * Suaviza a estimativa de banda antes de virar decisão.
 *
 * A medida do WebRTC oscila de segundo a segundo, e seguir cada pico faria a
 * qualidade pulsar de forma visível. A média exponencial segue a tendência e
 * ignora o tranco.
 *
 * Sobe devagar e desce depressa de propósito: superestimar a banda enche a
 * fila e trava a imagem para quem assiste, enquanto subestimar só custa um
 * pouco de nitidez até a próxima amostra.
 */
export function smoothBudgetMbps(previous: number | null, sampleMbps: number): number {
    if (!Number.isFinite(sampleMbps) || sampleMbps <= 0) return previous ?? 0;
    if (previous === null || previous <= 0) return sampleMbps;

    const peso = sampleMbps < previous ? 0.6 : 0.2;
    return previous + (sampleMbps - previous) * peso;
}

/**
 * Banda de subida utilizável, a partir do que cada conexão estimou.
 *
 * Cada espectador tem sua própria estimativa, e todas medem o mesmo cano de
 * saída. A maior é a leitura menos pessimista desse cano — as outras podem
 * estar limitadas pela rede de quem recebe, não pela de quem envia.
 */
export function usableBudgetMbps(samplesMbps: readonly number[]): number | null {
    const validos = samplesMbps.filter(v => Number.isFinite(v) && v > 0);
    if (!validos.length) return null;

    return Math.max(...validos);
}

/** "4,2 Mb/s" — vírgula decimal, que é como se escreve em português. */
export function formatMbps(bps: number): string {
    return `${(bps / 1_000_000).toFixed(1).replace(".", ",")} Mb/s`;
}
