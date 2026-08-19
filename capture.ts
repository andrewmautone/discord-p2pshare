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

/** O que o usuário escolheu na tela de compartilhamento. */
export interface CaptureChoice {
    /** Fonte de vídeo: "window:<hwnd>:…" ou "screen:<id>:…". */
    id: string;
    /** Transmitir áudio junto. */
    audio: boolean;
}

/**
 * Injetável para teste. Em produção fica tudo com o default, que aponta para
 * as APIs reais do browser/Electron.
 */
export interface CaptureDeps {
    getDisplayMedia?: (constraints: any) => Promise<MediaStream>;
    getUserMedia?: (constraints: any) => Promise<MediaStream>;
    getSources?: () => Promise<CaptureSource[]>;
    pickSource?: (sources: CaptureSource[]) => Promise<CaptureChoice | null>;
    /** Junta trilhas de origens diferentes num stream só. */
    combine?: (tracks: MediaStreamTrack[]) => MediaStream;
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

    // Sem seletor injetado, transmite a primeira fonte, sem áudio: mandar o
    // áudio do sistema devolveria a própria chamada para quem assiste.
    pickSource: async sources =>
        sources[0] ? { id: sources[0].id, audio: false } : null,

    combine: tracks => new MediaStream(tracks)
};

export interface CaptureOptions {
    /**
     * Capturar o áudio do sistema junto.
     *
     * O loopback do Windows pega TODO o áudio da máquina, incluindo o próprio
     * Discord — quem assiste ouve a chamada de volta. Não existe exclusão por
     * aplicativo exposta ao Electron, então a saída é poder desligar.
     */
    audio?: boolean;

    /**
     * Capturar o áudio deste dispositivo de entrada em vez do sistema inteiro.
     *
     * É a única forma de transmitir o áudio de um app só sem código nativo:
     * o Windows não expõe captura por processo ao Chromium, mas roteando o app
     * para um cabo virtual (VB-Cable e afins) o áudio dele vira um dispositivo
     * de entrada comum, que aqui é capturável.
     */
    audioDeviceId?: string | null;

    /**
     * Fornece a trilha de áudio depois que a fonte é escolhida.
     *
     * O áudio segue a escolha da tela: janela captura só o programa dela,
     * monitor captura tudo menos o Discord. Por isso só dá para pedir a
     * trilha depois de saber o que foi escolhido.
     */
    audioForSource?: (sourceId: string) => Promise<MediaStreamTrack | null>;
}

/**
 * Obtém o stream da tela.
 *
 * Tenta primeiro o DiscordNative, porque ele devolve a lista de telas e
 * janelas — é o que permite mostrar nosso próprio seletor com miniaturas.
 * Só quando ele não existe é que caímos no getDisplayMedia, que abre o
 * seletor nativo do Chromium e não nos dá escolha sobre a UI.
 */
export async function captureScreen(
    deps: CaptureDeps = {},
    opts: CaptureOptions = {}
): Promise<MediaStream> {
    const d = { ...defaultDeps, ...deps };
    const wantAudio = opts.audio !== false;

    let sources: CaptureSource[] = [];
    try {
        sources = await d.getSources();
    } catch (err) {
        console.warn("[P2PShare] DiscordNative indisponível, tentando getDisplayMedia", err);
    }

    if (sources.length) {
        const choice = await d.pickSource(sources);
        // Cancelar é decisão do usuário, não falha: não cai para o outro caminho.
        if (!choice) throw new CaptureError("captura cancelada pelo usuário");

        const sourceId = choice.id;
        // Quem manda é a escolha da tela de compartilhamento.
        const withAudio = wantAudio && choice.audio;

        const video = {
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sourceId,
                maxFrameRate: 60
            }
        };

        // Trilha vinda do auxiliar: só falta o vídeo, e os dois viram um
        // stream só.
        const isolated = withAudio && opts.audioForSource
            ? await opts.audioForSource(sourceId)
            : null;

        if (isolated) {
            const videoOnly = await d.getUserMedia({ audio: false, video })
                .catch((err: Error) => {
                    throw new CaptureError(`falha ao capturar a fonte: ${err.message}`);
                });

            return d.combine([...videoOnly.getTracks(), isolated]);
        }

        // Dispositivo escolhido: vídeo e áudio vêm de chamadas separadas e são
        // juntados depois, porque as constraints são incompatíveis entre si.
        if (withAudio && opts.audioDeviceId) {
            const videoOnly = await d.getUserMedia({ audio: false, video })
                .catch((err: Error) => {
                    throw new CaptureError(`falha ao capturar a fonte: ${err.message}`);
                });

            try {
                const mic = await d.getUserMedia({
                    audio: { deviceId: { exact: opts.audioDeviceId } },
                    video: false
                });
                return d.combine([...videoOnly.getTracks(), ...mic.getTracks()]);
            } catch (err) {
                // Dispositivo sumiu ou foi negado: melhor mudo que sem transmissão.
                console.warn("[P2PShare] dispositivo de áudio indisponível", err);
                return videoOnly;
            }
        }

        // Loopback do sistema: só quando o auxiliar não deu conta e mesmo
        // assim o usuário pediu áudio.
        if (withAudio) {
            try {
                return await d.getUserMedia({
                    audio: { mandatory: { chromeMediaSource: "desktop" } },
                    video
                });
            } catch (err) {
                console.warn("[P2PShare] sem áudio do sistema, transmitindo só vídeo", err);
            }
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
            audio: wantAudio
        });
    } catch (err) {
        throw new CaptureError(
            `nenhuma API de captura de tela disponível: ${(err as Error).message}`
        );
    }
}
