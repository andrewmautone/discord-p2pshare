/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Áudio em estéreo e 128 kb/s.
 *
 * O Opus do WebRTC, sem parâmetros, sai a ~36 kb/s e praticamente mono —
 * medido no Chromium 157 com música estéreo: 36 kb/s sem ajuste, 144 kb/s
 * com os parâmetros abaixo. A captura do P2PShare já é estéreo a 48 kHz; o
 * que faltava era pedir estéreo na negociação.
 *
 * Quem decide como o emissor codifica é o fmtp que o RECEPTOR declara. Como o
 * espectador é quem faz a offer, é na offer que isso entra. O emissor também
 * reescreve a offer que recebe, o que vale até para espectador de versão
 * antiga: decodificar estéreo todo Opus decodifica.
 */

export const OPUS_MAX_AVERAGE_BITRATE = 128_000;

const WANTED: ReadonlyArray<readonly [string, string]> = [
    ["stereo", "1"],
    ["sprop-stereo", "1"],
    ["maxaveragebitrate", String(OPUS_MAX_AVERAGE_BITRATE)]
];

/**
 * Acrescenta estéreo e o teto de bitrate ao fmtp do Opus, no SDP.
 * Não duplica parâmetros que já existam e nunca lança: SDP estranho volta
 * como veio.
 */
export function enhanceOpusSdp(sdp: string): string {
    try {
        const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
        const lines = sdp.split(eol);

        const opusPts = new Set<string>();
        for (const l of lines) {
            const m = /^a=rtpmap:(\d+) opus\//i.exec(l);
            if (m) opusPts.add(m[1]);
        }
        if (!opusPts.size) return sdp;

        const seen = new Set<string>();
        const out = lines.map(l => {
            const m = /^a=fmtp:(\d+) (.*)$/.exec(l);
            if (!m || !opusPts.has(m[1])) return l;

            seen.add(m[1]);
            const params = m[2].split(";").filter(Boolean);
            const have = new Set(params.map(p => p.split("=")[0].trim()));
            for (const [k, v] of WANTED) {
                if (!have.has(k)) params.push(`${k}=${v}`);
            }
            return `a=fmtp:${m[1]} ${params.join(";")}`;
        });

        // Opus sem linha fmtp: cria uma logo depois do rtpmap.
        const final: string[] = [];
        for (const l of out) {
            final.push(l);
            const m = /^a=rtpmap:(\d+) opus\//i.exec(l);
            if (m && !seen.has(m[1])) {
                final.push(`a=fmtp:${m[1]} ${WANTED.map(([k, v]) => `${k}=${v}`).join(";")}`);
            }
        }
        return final.join(eol);
    } catch {
        return sdp;
    }
}
