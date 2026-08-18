/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export class CaptureError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CaptureError";
    }
}

export interface CaptureSource {
    id: string;
    name: string;
}

/**
 * Injetável para teste. Em produção fica tudo com o default, que aponta para
 * as APIs reais do browser/Electron.
 */
export interface CaptureDeps {
    getDisplayMedia?: (constraints: any) => Promise<MediaStream>;
    getUserMedia?: (constraints: any) => Promise<MediaStream>;
    getSources?: () => Promise<CaptureSource[]>;
    pickSource?: (sources: CaptureSource[]) => Promise<string | null>;
}

const defaultDeps: Required<CaptureDeps> = {
    getDisplayMedia: c => navigator.mediaDevices.getDisplayMedia(c),
    getUserMedia: c => navigator.mediaDevices.getUserMedia(c),

    getSources: async () => {
        const native = (window as any).DiscordNative?.desktopCapture;
        if (!native?.getDesktopCaptureSources) {
            throw new Error("DiscordNative.desktopCapture indisponível");
        }
        return native.getDesktopCaptureSources({ types: ["screen", "window"] });
    },

    // Sem picker próprio: transmite a primeira fonte, que é a tela principal.
    pickSource: async sources => sources[0]?.id ?? null
};

/**
 * Obtém o stream da tela tentando, em ordem:
 *   1. navigator.mediaDevices.getDisplayMedia
 *   2. DiscordNative.desktopCapture + getUserMedia com chromeMediaSource
 *
 * Não dá para saber de antemão qual das duas o Electron do Discord expõe,
 * então a primeira que funcionar vence.
 */
export async function captureScreen(deps: CaptureDeps = {}): Promise<MediaStream> {
    const d = { ...defaultDeps, ...deps };

    try {
        return await d.getDisplayMedia({
            video: { frameRate: { ideal: 60 } },
            audio: true
        });
    } catch (err) {
        console.warn("[P2PShare] getDisplayMedia indisponível, tentando DiscordNative", err);
    }

    let sources: CaptureSource[];
    try {
        sources = await d.getSources();
    } catch (err) {
        throw new CaptureError(
            `nenhuma API de captura de tela disponível: ${(err as Error).message}`
        );
    }

    if (!sources.length) throw new CaptureError("nenhuma fonte de captura encontrada");

    const sourceId = await d.pickSource(sources);
    if (!sourceId) throw new CaptureError("captura cancelada pelo usuário");

    try {
        return await d.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: "desktop",
                    chromeMediaSourceId: sourceId,
                    maxFrameRate: 60
                }
            }
        });
    } catch (err) {
        throw new CaptureError(`falha ao capturar a fonte: ${(err as Error).message}`);
    }
}
