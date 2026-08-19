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

        return native.getDesktopCaptureSources({
            types: ["screen", "window"],
            thumbnailSize: { width: 320, height: 180 }
        });
    },

    // Sem seletor injetado, transmite a primeira fonte (a tela principal).
    pickSource: async sources => sources[0]?.id ?? null
};

/**
 * Obtém o stream da tela.
 *
 * Tenta primeiro o DiscordNative, porque ele devolve a lista de telas e
 * janelas — é o que permite mostrar nosso próprio seletor com miniaturas.
 * Só quando ele não existe é que caímos no getDisplayMedia, que abre o
 * seletor nativo do Chromium e não nos dá escolha sobre a UI.
 */
export async function captureScreen(deps: CaptureDeps = {}): Promise<MediaStream> {
    const d = { ...defaultDeps, ...deps };

    let sources: CaptureSource[] = [];
    try {
        sources = await d.getSources();
    } catch (err) {
        console.warn("[P2PShare] DiscordNative indisponível, tentando getDisplayMedia", err);
    }

    if (sources.length) {
        const sourceId = await d.pickSource(sources);
        // Cancelar é decisão do usuário, não falha: não cai para o outro caminho.
        if (!sourceId) throw new CaptureError("captura cancelada pelo usuário");

        const video = {
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sourceId,
                maxFrameRate: 60
            }
        };

        // Áudio do sistema (loopback). No Electron isto exige chromeMediaSource
        // "desktop" também no áudio — sem esse bloco a transmissão vai muda.
        try {
            return await d.getUserMedia({
                audio: { mandatory: { chromeMediaSource: "desktop" } },
                video
            });
        } catch (err) {
            console.warn("[P2PShare] sem áudio do sistema, transmitindo só vídeo", err);
        }

        // Nem toda máquina tem loopback: melhor transmitir mudo que não transmitir.
        try {
            return await d.getUserMedia({ audio: false, video });
        } catch (err) {
            throw new CaptureError(`falha ao capturar a fonte: ${(err as Error).message}`);
        }
    }

    try {
        return await d.getDisplayMedia({
            video: { frameRate: { ideal: 60 } },
            audio: true
        });
    } catch (err) {
        throw new CaptureError(
            `nenhuma API de captura de tela disponível: ${(err as Error).message}`
        );
    }
}
