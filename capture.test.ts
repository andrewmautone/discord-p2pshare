/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CaptureError, captureScreen } from "./capture";

const fakeStream = { id: "fake" } as unknown as MediaStream;

describe("captureScreen", () => {
    it("usa getDisplayMedia quando disponível", async () => {
        const stream = await captureScreen({
            getDisplayMedia: async () => fakeStream
        });
        assert.equal(stream, fakeStream);
    });

    it("cai para getUserMedia quando getDisplayMedia falha", async () => {
        let usedConstraints: any;
        const stream = await captureScreen({
            getDisplayMedia: async () => { throw new Error("não suportado"); },
            getSources: async () => [{ id: "screen:0", name: "Tela 1" }],
            pickSource: async sources => sources[0].id,
            getUserMedia: async c => { usedConstraints = c; return fakeStream; }
        });

        assert.equal(stream, fakeStream);
        assert.equal(usedConstraints.video.mandatory.chromeMediaSource, "desktop");
        assert.equal(usedConstraints.video.mandatory.chromeMediaSourceId, "screen:0");
    });

    it("lança CaptureError quando o usuário cancela a escolha da fonte", async () => {
        await assert.rejects(
            () => captureScreen({
                getDisplayMedia: async () => { throw new Error("não suportado"); },
                getSources: async () => [{ id: "screen:0", name: "Tela 1" }],
                pickSource: async () => null,
                getUserMedia: async () => fakeStream
            }),
            (err: Error) => err instanceof CaptureError && /cancel/i.test(err.message)
        );
    });

    it("lança CaptureError quando nenhuma API funciona", async () => {
        await assert.rejects(
            () => captureScreen({
                getDisplayMedia: async () => { throw new Error("não suportado"); },
                getSources: async () => { throw new Error("sem DiscordNative"); }
            }),
            (err: Error) => err instanceof CaptureError
        );
    });

    it("lança CaptureError quando não há nenhuma fonte", async () => {
        await assert.rejects(
            () => captureScreen({
                getDisplayMedia: async () => { throw new Error("não suportado"); },
                getSources: async () => []
            }),
            (err: Error) => err instanceof CaptureError && /fonte/i.test(err.message)
        );
    });

    it("lança CaptureError quando getUserMedia falha na fonte escolhida", async () => {
        await assert.rejects(
            () => captureScreen({
                getDisplayMedia: async () => { throw new Error("não suportado"); },
                getSources: async () => [{ id: "screen:0", name: "Tela 1" }],
                pickSource: async () => "screen:0",
                getUserMedia: async () => { throw new Error("permissão negada"); }
            }),
            (err: Error) => err instanceof CaptureError && /permissão negada/.test(err.message)
        );
    });
});
