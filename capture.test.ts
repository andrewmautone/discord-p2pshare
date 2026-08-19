/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CaptureError, captureScreen } from "./capture";

const fakeStream = { id: "fake" } as unknown as MediaStream;
const twoSources = [
    { id: "screen:0", name: "Tela 1" },
    { id: "window:12", name: "Visual Studio Code" }
];

describe("captureScreen", () => {
    it("prefere as fontes nativas, para poder mostrar o seletor", async () => {
        let offered: unknown;
        let usedConstraints: any;

        const stream = await captureScreen({
            getSources: async () => twoSources,
            pickSource: async sources => { offered = sources; return "window:12"; },
            getUserMedia: async c => { usedConstraints = c; return fakeStream; },
            getDisplayMedia: async () => { throw new Error("não deveria ser chamado"); }
        });

        assert.equal(stream, fakeStream);
        assert.deepEqual(offered, twoSources, "o seletor recebe todas as fontes");
        assert.equal(usedConstraints.video.mandatory.chromeMediaSource, "desktop");
        assert.equal(usedConstraints.video.mandatory.chromeMediaSourceId, "window:12");
    });

    it("pede o audio do sistema junto do video", async () => {
        let usedConstraints: any;

        await captureScreen({
            getSources: async () => twoSources,
            pickSource: async () => "screen:0",
            getUserMedia: async c => { usedConstraints = c; return fakeStream; }
        });

        assert.equal(
            usedConstraints.audio.mandatory.chromeMediaSource,
            "desktop",
            "sem isto a transmissao vai muda"
        );
    });

    it("captura de um dispositivo especifico quando escolhido", async () => {
        const constraints: any[] = [];
        const videoTrack = { kind: "video" } as MediaStreamTrack;
        const audioTrack = { kind: "audio" } as MediaStreamTrack;
        let combined: MediaStreamTrack[] = [];

        await captureScreen({
            getSources: async () => twoSources,
            pickSource: async () => "screen:0",
            getUserMedia: async (c: any) => {
                constraints.push(c);
                return {
                    getTracks: () => (c.video ? [videoTrack] : [audioTrack])
                } as unknown as MediaStream;
            },
            combine: tracks => { combined = tracks; return {} as MediaStream; }
        }, { audioDeviceId: "cabo-virtual" });

        assert.equal(constraints[0].audio, false, "video vem sem audio");
        assert.deepEqual(constraints[1].audio, { deviceId: { exact: "cabo-virtual" } });
        assert.deepEqual(combined, [videoTrack, audioTrack], "junta as duas trilhas");
    });

    it("segue so com video quando o dispositivo escolhido falha", async () => {
        const videoTrack = { kind: "video" } as MediaStreamTrack;
        const videoStream = { getTracks: () => [videoTrack] } as unknown as MediaStream;

        const stream = await captureScreen({
            getSources: async () => twoSources,
            pickSource: async () => "screen:0",
            getUserMedia: async (c: any) => {
                if (c.video) return videoStream;
                throw new Error("dispositivo removido");
            }
        }, { audioDeviceId: "sumiu" });

        assert.equal(stream, videoStream, "melhor mudo que sem transmissao");
    });

    it("nao pede audio quando o usuario desligou", async () => {
        const attempts: any[] = [];

        await captureScreen({
            getSources: async () => twoSources,
            pickSource: async () => "screen:0",
            getUserMedia: async c => { attempts.push(c); return fakeStream; }
        }, { audio: false });

        assert.equal(attempts.length, 1, "nao tenta com audio antes");
        assert.equal(attempts[0].audio, false);
    });

    it("cai para video sem audio quando o loopback nao existe", async () => {
        const attempts: any[] = [];

        const stream = await captureScreen({
            getSources: async () => twoSources,
            pickSource: async () => "screen:0",
            getUserMedia: async c => {
                attempts.push(c);
                // Primeira tentativa (com audio) falha, como em maquinas sem loopback.
                if (c.audio) throw new Error("audio device not found");
                return fakeStream;
            }
        });

        assert.equal(stream, fakeStream);
        assert.equal(attempts.length, 2, "tenta com audio, depois sem");
        assert.equal(attempts[1].audio, false);
        assert.equal(attempts[1].video.mandatory.chromeMediaSourceId, "screen:0");
    });

    it("cai para getDisplayMedia quando não há API nativa", async () => {
        const stream = await captureScreen({
            getSources: async () => { throw new Error("sem DiscordNative"); },
            getDisplayMedia: async () => fakeStream
        });

        assert.equal(stream, fakeStream);
    });

    it("cai para getDisplayMedia quando a lista de fontes vem vazia", async () => {
        const stream = await captureScreen({
            getSources: async () => [],
            getDisplayMedia: async () => fakeStream
        });

        assert.equal(stream, fakeStream);
    });

    it("cancelar no seletor aborta, sem cair para getDisplayMedia", async () => {
        let displayMediaCalled = false;

        await assert.rejects(
            () => captureScreen({
                getSources: async () => twoSources,
                pickSource: async () => null,
                getUserMedia: async () => fakeStream,
                getDisplayMedia: async () => { displayMediaCalled = true; return fakeStream; }
            }),
            (err: Error) => err instanceof CaptureError && /cancel/i.test(err.message)
        );

        assert.equal(displayMediaCalled, false, "cancelar é decisão do usuário, não falha");
    });

    it("lança CaptureError quando nenhuma das duas APIs funciona", async () => {
        await assert.rejects(
            () => captureScreen({
                getSources: async () => { throw new Error("sem DiscordNative"); },
                getDisplayMedia: async () => { throw new Error("não suportado"); }
            }),
            (err: Error) => err instanceof CaptureError
        );
    });

    it("lança CaptureError quando getUserMedia falha na fonte escolhida", async () => {
        await assert.rejects(
            () => captureScreen({
                getSources: async () => twoSources,
                pickSource: async () => "screen:0",
                getUserMedia: async () => { throw new Error("permissão negada"); }
            }),
            (err: Error) => err instanceof CaptureError && /permissão negada/.test(err.message)
        );
    });
});
