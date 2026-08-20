/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatMbps, smoothBudgetMbps, usableBudgetMbps } from "./bitrate";

describe("smoothBudgetMbps", () => {
    it("adota a primeira amostra como está", () => {
        assert.equal(smoothBudgetMbps(null, 10), 10);
    });

    // Encher a fila trava a imagem; perder nitidez, não. A assimetria é
    // deliberada e é o que este teste protege.
    it("desce mais rápido do que sobe", () => {
        const queda = 10 - smoothBudgetMbps(10, 2);
        const subida = smoothBudgetMbps(10, 18) - 10;

        assert.ok(queda / 8 > subida / 8, "a queda deve pesar mais que a subida");
    });

    it("ignora amostra inválida em vez de zerar o orçamento", () => {
        assert.equal(smoothBudgetMbps(7, 0), 7);
        assert.equal(smoothBudgetMbps(7, Number.NaN), 7);
    });
});

describe("usableBudgetMbps", () => {
    it("não inventa número quando ninguém mediu", () => {
        assert.equal(usableBudgetMbps([]), null);
        assert.equal(usableBudgetMbps([0, Number.NaN]), null);
    });

    // Um espectador com internet ruim limita a própria conexão, não a
    // capacidade de subida de quem transmite.
    it("usa a leitura menos pessimista do cano de saída", () => {
        assert.equal(usableBudgetMbps([2, 14, 5]), 14);
    });
});

describe("formatMbps", () => {
    it("escreve com vírgula decimal", () => {
        assert.equal(formatMbps(4_200_000), "4,2 Mb/s");
    });
});
