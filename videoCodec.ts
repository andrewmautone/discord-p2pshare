/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Escolha do codec de vídeo.
 *
 * Ordem de preferência, igual à do Discord oficial:
 *   1. AV1 — só com hardware nos dois lados (software gasta ~2 núcleos a 1080p60)
 *   2. H.265 — só com hardware
 *   3. H.264 — o mais leve; entra sempre
 *   4. VP8 — último recurso
 *
 * VP9 fica de fora de propósito: é software e perdeu para H.264/AV1 na medição.
 *
 * A negociação continua sendo do SDP. Quem assiste (offerer) lista só o que
 * decodifica bem; quem transmite (answerer) tira o que não codifica em
 * hardware. A resposta cai no primeiro codec em comum, e sem hardware em
 * nenhum lado o resultado é H.264, com VP8 como fallback.
 */

export type VideoCodecName = "AV1" | "H265" | "H264" | "VP8";

/** Mais preferido primeiro. */
export const CODEC_PREFERENCE: readonly VideoCodecName[] = ["AV1", "H265", "H264", "VP8"];

/** Codecs que só valem a pena se houver hardware. */
const HARDWARE_ONLY: ReadonlySet<VideoCodecName> = new Set<VideoCodecName>(["AV1", "H265"]);

export interface CodecLike {
    mimeType: string;
}

export type HardwareSupport = Partial<Record<VideoCodecName, boolean>>;

function nameOf(mimeType: string): VideoCodecName | null {
    const sub = mimeType.toLowerCase().replace(/^video\//, "");
    switch (sub) {
        case "av1": return "AV1";
        case "h265": case "hevc": return "H265";
        case "h264": return "H264";
        case "vp8": return "VP8";
        default: return null;
    }
}

/**
 * Ordena e filtra a lista de codecs de um transceiver.
 *
 * Mantém os codecs auxiliares (rtx, red, ulpfec) no fim, que o WebRTC precisa
 * para retransmissão. Se nada sobrar além deles, devolve a lista original: um
 * navegador que só tem VP9 continua funcionando.
 */
export function orderVideoCodecs<T extends CodecLike>(codecs: readonly T[], hardware: HardwareSupport): T[] {
    const rank = (c: T): number => {
        const name = nameOf(c.mimeType);
        return name === null ? -1 : CODEC_PREFERENCE.indexOf(name);
    };

    const usable = codecs
        .filter(c => {
            const name = nameOf(c.mimeType);
            if (name === null) return false;
            return !HARDWARE_ONLY.has(name) || hardware[name] === true;
        })
        .sort((a, b) => rank(a) - rank(b)); // sort é estável: perfis do mesmo codec mantêm a ordem

    if (!usable.length) return [...codecs];

    const aux = codecs.filter(c => /\/(rtx|red|ulpfec|flexfec-03)$/i.test(c.mimeType));
    return [...usable, ...aux];
}


/**
 * Tira do SDP recebido (offer) os codecs que esta máquina não codifica bem.
 *
 * Medido no Chromium 157: filtrar só a resposta com setCodecPreferences NÃO
 * basta — quem transmite seguia usando o primeiro codec da offer (AV1 em
 * software, ~2 núcleos de CPU). Remover o codec da offer antes do
 * setRemoteDescription é o que realmente decide.
 *
 * Se a remoção deixaria a seção de vídeo sem nenhum codec, devolve o SDP
 * intacto.
 */
export function stripCodecsFromSdp(sdp: string, drop: ReadonlySet<VideoCodecName>): string {
    if (!drop.size) return sdp;

    const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
    const lines = sdp.split(eol);
    const out: string[] = [];

    let i = 0;
    while (i < lines.length) {
        if (!lines[i].startsWith("m=video")) { out.push(lines[i++]); continue; }

        let j = i + 1;
        while (j < lines.length && !lines[j].startsWith("m=")) j++;
        const section = lines.slice(i, j);

        const byPt = new Map<string, string>();
        for (const l of section) {
            const m = /^a=rtpmap:(\d+) ([^/\s]+)/.exec(l);
            if (m) byPt.set(m[1], m[2]);
        }

        const dropPts = new Set<string>();
        for (const [pt, codec] of byPt) {
            const name = nameOf("video/" + codec);
            if (name && drop.has(name)) dropPts.add(pt);
        }
        // rtx de um codec removido: fmtp "apt=<pt>"
        for (const l of section) {
            const m = /^a=fmtp:(\d+) .*apt=(\d+)/.exec(l);
            if (m && dropPts.has(m[2])) dropPts.add(m[1]);
        }

        const header = section[0].split(" ");
        const pts = header.slice(3);
        const kept = pts.filter(pt => !dropPts.has(pt));
        const hasRealCodec = kept.some(pt => {
            const n = nameOf("video/" + (byPt.get(pt) ?? ""));
            return n !== null;
        });

        if (!dropPts.size || !hasRealCodec) {
            out.push(...section);
        } else {
            out.push([...header.slice(0, 3), ...kept].join(" "));
            for (const l of section.slice(1)) {
                const m = /^a=(?:rtpmap|fmtp|rtcp-fb):(\d+) /.exec(l);
                if (m && dropPts.has(m[1])) continue;
                out.push(l);
            }
        }
        i = j;
    }

    return out.join(eol);
}

/** Codecs que esta máquina não codifica em hardware e portanto saem da offer. */
export async function codecsToDropForEncode(): Promise<Set<VideoCodecName>> {
    const hw = await detectHardwareCodecs("encode");
    const drop = new Set<VideoCodecName>();
    for (const name of ["AV1", "H265"] as const) if (!hw[name]) drop.add(name);
    return drop;
}

type Direction = "encode" | "decode";

const PROBE: Record<VideoCodecName, { contentType: string; }> = {
    AV1: { contentType: "video/AV1" },
    H265: { contentType: "video/H265" },
    H264: { contentType: "video/H264;profile-level-id=42e01f" },
    VP8: { contentType: "video/VP8" }
};

const cache = new Map<Direction, Promise<HardwareSupport>>();

/**
 * Pergunta ao navegador o que ele faz por hardware (`powerEfficient`).
 * Nunca lança: qualquer falha vira "sem hardware", que é o caminho seguro.
 */
export function detectHardwareCodecs(direction: Direction): Promise<HardwareSupport> {
    let hit = cache.get(direction);
    if (!hit) {
        hit = probe(direction).catch(() => ({}));
        cache.set(direction, hit);
    }
    return hit;
}

async function probe(direction: Direction): Promise<HardwareSupport> {
    const mc: MediaCapabilities | undefined = (globalThis as any).navigator?.mediaCapabilities;
    if (!mc) return {};

    const out: HardwareSupport = {};
    for (const name of ["AV1", "H265", "H264"] as const) {
        try {
            const cfg: any = {
                type: "webrtc",
                video: {
                    contentType: PROBE[name].contentType,
                    width: 1920,
                    height: 1080,
                    framerate: 60,
                    bitrate: 8_000_000
                }
            };
            const info = direction === "encode"
                ? await mc.encodingInfo(cfg)
                : await mc.decodingInfo(cfg);
            out[name] = !!(info.supported && info.powerEfficient);
        } catch {
            out[name] = false;
        }
    }
    return out;
}

/**
 * Aplica a preferência a um transceiver de vídeo. Silencioso em qualquer
 * falha: codec é otimização, nunca pode derrubar a transmissão.
 */
export async function applyCodecPreference(
    transceiver: { setCodecPreferences?: (codecs: any[]) => void; } | undefined,
    direction: Direction
): Promise<void> {
    try {
        const RTR = (globalThis as any).RTCRtpSender;
        const RTRecv = (globalThis as any).RTCRtpReceiver;
        const caps = (direction === "encode" ? RTR : RTRecv)?.getCapabilities?.("video");
        if (!caps?.codecs || !transceiver?.setCodecPreferences) return;

        const hw = await detectHardwareCodecs(direction);
        transceiver.setCodecPreferences(orderVideoCodecs(caps.codecs, hw));
    } catch (err) {
        console.warn("[P2PShare] preferência de codec ignorada", err);
    }
}
