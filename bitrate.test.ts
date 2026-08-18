/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computePerPeerBitrate } from "./bitrate";
import { MAX_BITRATE, MIN_BITRATE } from "./constants";

describe("computePerPeerBitrate", () => {
    it("divide o orçamento entre os viewers", () => {
        // 15 Mbps / 3 = 5 Mbps
        assert.equal(computePerPeerBitrate(15, 3), 5_000_000);
    });

    it("limita no teto quando há poucos viewers", () => {
        // 15 Mbps / 1 = 15 Mbps, acima do teto
        assert.equal(computePerPeerBitrate(15, 1), MAX_BITRATE);
    });

    it("limita no piso quando há muitos viewers", () => {
        // 15 Mbps / 100 = 150 kbps, abaixo do piso
        assert.equal(computePerPeerBitrate(15, 100), MIN_BITRATE);
    });

    it("devolve o teto quando não há viewers", () => {
        assert.equal(computePerPeerBitrate(15, 0), MAX_BITRATE);
    });

    it("trata viewerCount negativo como zero", () => {
        assert.equal(computePerPeerBitrate(15, -2), MAX_BITRATE);
    });

    it("respeita orçamento pequeno", () => {
        // 4 Mbps / 2 = 2 Mbps, dentro dos limites
        assert.equal(computePerPeerBitrate(4, 2), 2_000_000);
    });

    it("devolve inteiro mesmo com divisão quebrada", () => {
        const result = computePerPeerBitrate(10, 3);
        assert.equal(result, Math.round(result));
    });
});
