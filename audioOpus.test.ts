/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enhanceOpusSdp } from "./audioOpus";

const base = (fmtp: string) => [
    "v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 111 63",
    "a=rtpmap:111 opus/48000/2", ...(fmtp ? [fmtp] : []),
    "a=rtpmap:63 red/48000/2", "a=fmtp:63 111/111",
    "m=video 9 UDP/TLS/RTP/SAVPF 96", "a=rtpmap:96 VP8/90000", ""
].join("\r\n");

describe("enhanceOpusSdp", () => {
    it("acrescenta estereo e teto de 128 kb/s ao fmtp do Opus", () => {
        const r = enhanceOpusSdp(base("a=fmtp:111 minptime=10;useinbandfec=1"));
        assert.ok(r.includes("a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000"));
    });

    it("nao mexe no fmtp de outros codecs (red)", () => {
        assert.ok(enhanceOpusSdp(base("a=fmtp:111 minptime=10")).includes("a=fmtp:63 111/111\r\n"));
    });

    it("cria o fmtp quando o Opus nao tem", () => {
        const r = enhanceOpusSdp(base(""));
        assert.ok(r.includes("a=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=1;sprop-stereo=1;maxaveragebitrate=128000\r\n"));
    });

    it("nao duplica nem sobrescreve o que ja existe", () => {
        const r = enhanceOpusSdp(base("a=fmtp:111 stereo=1;maxaveragebitrate=64000"));
        assert.equal(r.match(/maxaveragebitrate/g)?.length, 1);
        assert.ok(r.includes("maxaveragebitrate=64000"));
        assert.equal(r.match(/(?<![-\w])stereo=1/g)?.length, 1);
    });

    it("idempotente", () => {
        const once = enhanceOpusSdp(base("a=fmtp:111 minptime=10"));
        assert.equal(enhanceOpusSdp(once), once);
    });

    it("SDP sem Opus ou lixo volta igual", () => {
        assert.equal(enhanceOpusSdp("v=0\r\nm=video 9 X 96\r\n"), "v=0\r\nm=video 9 X 96\r\n");
        assert.equal(enhanceOpusSdp("SDP_OFFER"), "SDP_OFFER");
    });
});
