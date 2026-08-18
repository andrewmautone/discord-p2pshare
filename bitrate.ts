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
