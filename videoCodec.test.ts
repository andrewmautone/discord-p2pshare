/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { orderVideoCodecs } from "./videoCodec";

const caps = ["video/VP8", "video/rtx", "video/H264", "video/H264", "video/AV1", "video/VP9", "video/H265", "video/red", "video/ulpfec"]
    .map(mimeType => ({ mimeType }));
const names = (l: { mimeType: string; }[]) => l.map(c => c.mimeType.replace("video/", ""));

describe("orderVideoCodecs", () => {
    it("com hardware em tudo: AV1, H265, H264, VP8; VP9 some; auxiliares no fim", () => {
        const r = orderVideoCodecs(caps, { AV1: true, H265: true, H264: true });
        assert.deepEqual(names(r), ["AV1", "H265", "H264", "H264", "VP8", "rtx", "red", "ulpfec"]);
    });

    it("sem hardware: H264 primeiro, VP8 de fallback, sem AV1 nem H265", () => {
        assert.deepEqual(names(orderVideoCodecs(caps, {})), ["H264", "H264", "VP8", "rtx", "red", "ulpfec"]);
    });

    it("so H265 em hardware: H265 antes de H264", () => {
        assert.deepEqual(names(orderVideoCodecs(caps, { H265: true })).slice(0, 2), ["H265", "H264"]);
    });

    it("navegador so com VP9: devolve a lista original", () => {
        const only = [{ mimeType: "video/VP9" }, { mimeType: "video/rtx" }];
        assert.deepEqual(orderVideoCodecs(only, {}), only);
    });
});

import { stripCodecsFromSdp } from "./videoCodec";

const SDP = [
    "v=0", "m=audio 9 UDP/TLS/RTP/SAVPF 111", "a=rtpmap:111 opus/48000/2",
    "m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100",
    "a=rtpmap:96 AV1/90000", "a=rtcp-fb:96 nack", "a=rtpmap:97 rtx/90000", "a=fmtp:97 apt=96",
    "a=rtpmap:98 H264/90000", "a=rtpmap:99 rtx/90000", "a=fmtp:99 apt=98", "a=rtpmap:100 VP8/90000", ""
].join("\r\n");

describe("stripCodecsFromSdp", () => {
    it("remove AV1 e o rtx dele, sem tocar nos outros", () => {
        const r = stripCodecsFromSdp(SDP, new Set(["AV1"] as const));
        assert.ok(r.includes("m=video 9 UDP/TLS/RTP/SAVPF 98 99 100"));
        assert.ok(!r.includes("AV1") && !r.includes("apt=96") && !r.includes("a=rtcp-fb:96"));
        assert.ok(r.includes("apt=98") && r.includes("opus"));
    });

    it("nada para remover devolve o mesmo SDP", () => {
        assert.equal(stripCodecsFromSdp(SDP, new Set()), SDP);
    });

    it("nao deixa a secao de video sem codec", () => {
        const so = SDP.replace(/a=rtpmap:98[^]*?a=rtpmap:100 VP8\/90000/, "a=rtpmap:100 VP8/90000").replace("96 97 98 99 100", "96 97 100");
        assert.equal(stripCodecsFromSdp(so.replace("VP8", "AV1"), new Set(["AV1"] as const)).includes("m=video"), true);
    });
});
