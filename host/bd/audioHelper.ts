/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HELPER_SHA256, HELPER_URL } from "../../constants";

declare const BdApi: any;

/**
 * Áudio do sistema sem o Discord dentro.
 *
 * O Chromium não captura áudio por processo: `chromeMediaSource: "desktop"`
 * traz a máquina inteira, e quem assiste ouve a própria chamada de volta. O
 * Windows resolve isso com `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`,
 * que aceita excluir uma árvore de processos — mas é API nativa, fora do
 * alcance de JavaScript.
 *
 * Daí o executável auxiliar: ele captura excluindo a árvore do Discord e
 * escreve PCM no stdout. Aqui esse PCM vira uma MediaStreamTrack comum, que
 * entra na conexão como qualquer outra trilha.
 *
 * O download é sempre consentido e o binário é conferido por SHA-256 antes de
 * gravar. Baixar e executar código nativo sem isso seria uma porta dos fundos.
 */

const HELPER_NAME = "p2pshare-audio.exe";
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
/** ~1s de folga: absorve engasgo do pipe sem atrasar demais o áudio. */
const RING_FRAMES = SAMPLE_RATE;

function helperPath(): string {
    const path = require("path");
    return path.join(BdApi.Plugins.folder, HELPER_NAME);
}

function sha256(buffer: Buffer): string {
    return require("crypto").createHash("sha256").update(buffer).digest("hex");
}

/** O arquivo em disco é mesmo o binário que publicamos? */
function localHelperIsValid(): boolean {
    try {
        const fs = require("fs");
        const file = helperPath();
        if (!fs.existsSync(file)) return false;

        return sha256(fs.readFileSync(file)) === HELPER_SHA256;
    } catch {
        return false;
    }
}

function confirmDownload(): Promise<boolean> {
    return new Promise(resolve => {
        BdApi.UI.showConfirmationModal(
            "Baixar o componente de áudio?",
            "Para transmitir o som sem devolver o áudio do próprio Discord, o " +
            "P2PShare precisa de um pequeno programa auxiliar (140 KB). Ele é " +
            "baixado do repositório do projeto e conferido por assinatura " +
            "antes de ser gravado.\n\n" +
            "Sem ele, a transmissão usa o áudio do sistema inteiro — o que " +
            "inclui a chamada de voz.",
            {
                confirmText: "Baixar",
                cancelText: "Usar o áudio do sistema",
                onConfirm: () => resolve(true),
                onCancel: () => resolve(false)
            }
        );
    });
}

/** Já instalado e íntegro? Não pergunta nada, não baixa nada. */
export function helperReady(): boolean {
    return localHelperIsValid();
}

/**
 * Garante o binário em disco. Devolve o caminho, ou null se não deu.
 *
 * `prompt: false` é o caminho de quem está transmitindo: ali o componente é
 * um bônus, e parar para perguntar no meio do fluxo atrapalharia o seletor de
 * tela que vem logo depois. Quem pergunta é a tela de configurações.
 */
export async function ensureHelper(
    { prompt = true }: { prompt?: boolean; } = {}
): Promise<string | null> {
    if (localHelperIsValid()) return helperPath();
    if (!prompt) return null;

    if (!await confirmDownload()) return null;

    try {
        const res = await fetch(HELPER_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`o servidor respondeu ${res.status}`);

        const buffer = Buffer.from(await res.arrayBuffer());
        const digest = sha256(buffer);

        if (digest !== HELPER_SHA256) {
            // Só chega aqui se o arquivo publicado não for o que este plugin
            // espera. Executar assim seria rodar código não verificado.
            throw new Error(
                `assinatura não confere (esperado ${HELPER_SHA256.slice(0, 12)}, ` +
                `veio ${digest.slice(0, 12)})`
            );
        }

        require("fs").writeFileSync(helperPath(), buffer);
        BdApi.UI.showToast("Componente de áudio instalado", { type: "success" });
        return helperPath();
    } catch (err) {
        BdApi.UI.showToast(
            `Não deu para baixar o componente de áudio: ${(err as Error).message}`,
            { type: "error" }
        );
        return null;
    }
}

/** Baixa sob pedido explícito, a partir das configurações. */
export function downloadHelper(): Promise<string | null> {
    return ensureHelper({ prompt: true });
}

export interface AudioApp {
    pid: number;
    name: string;
}

/**
 * Processos com som ativo agora.
 *
 * Só aparece quem tem sessão de áudio aberta — um jogo que ainda não emitiu
 * nada não entra na lista, e é por isso que a escolha é guardada pelo nome do
 * executável, não pelo PID, que muda a cada abertura.
 */
export async function listAudioApps(): Promise<AudioApp[]> {
    const exe = await ensureHelper({ prompt: false });
    if (!exe) return [];

    return new Promise(resolve => {
        try {
            const child = require("child_process").spawn(exe, ["--list"], { windowsHide: true });

            let out = "";
            child.stdout.on("data", (d: Buffer) => { out += d.toString(); });

            child.on("close", () => {
                try {
                    resolve(JSON.parse(out.trim() || "[]"));
                } catch {
                    resolve([]);
                }
            });

            child.on("error", () => resolve([]));
        } catch {
            resolve([]);
        }
    });
}

/**
 * PID da árvore do Discord a excluir.
 *
 * O renderer é filho do processo principal, então excluir a árvore do pai
 * cobre o Discord inteiro — inclusive o processo que toca o áudio da chamada.
 */
function discordTreePid(): number {
    return (process as any).ppid || process.pid;
}

export interface IsolatedAudio {
    track: MediaStreamTrack;
    stop: () => void;
}

/**
 * Liga o helper e devolve uma trilha de áudio pronta para a conexão.
 *
 * Devolve null quando o binário não está disponível: nesse caso quem chama
 * segue com o áudio do sistema, que é pior mas funciona.
 */
export interface IsolationRequest {
    /** "discord" tira o Discord do caminho; "app" captura só um programa. */
    mode: "discord" | "app";
    /** Nome do executável quando o modo é "app". */
    appName?: string | null;
}

/**
 * Monta os argumentos do auxiliar.
 *
 * Devolve null quando o app escolhido não está tocando nada: sem PID não há o
 * que capturar, e é melhor cair para o áudio do sistema que transmitir mudo
 * sem explicação.
 */
async function helperArgs(request: IsolationRequest): Promise<string[] | null> {
    if (request.mode !== "app") {
        return ["--exclude", String(discordTreePid())];
    }

    if (!request.appName) return null;

    const app = (await listAudioApps())
        .find(a => a.name.toLowerCase() === request.appName!.toLowerCase());

    if (!app) {
        BdApi.UI.showToast(
            `${request.appName} não está tocando som agora — usando o áudio do sistema`,
            { type: "warning" }
        );
        return null;
    }

    return ["--include", String(app.pid)];
}

export async function captureIsolatedAudio(
    request: IsolationRequest = { mode: "discord" }
): Promise<IsolatedAudio | null> {
    // Sem prompt: transmitir não é hora de instalar nada. Faltando o
    // componente, o áudio do sistema entra no lugar sem alarde.
    const exe = await ensureHelper({ prompt: false });
    if (!exe) {
        console.info("[P2PShare] componente de áudio ausente, usando o áudio do sistema");
        return null;
    }

    const args = await helperArgs(request);
    if (!args) return null;

    try {
        const child = require("child_process").spawn(exe, args, { windowsHide: true });

        const context = new AudioContext({ sampleRate: SAMPLE_RATE });
        const destination = context.createMediaStreamDestination();

        // Buffer circular: o pipe entrega em rajadas, o áudio consome em ritmo
        // constante. Sem folga entre os dois, sairia picotado.
        const ring = new Float32Array(RING_FRAMES * CHANNELS);
        let writeAt = 0;
        let readAt = 0;
        let available = 0;

        // Um chunk do pipe pode terminar no meio de um float; o resto espera
        // o próximo pedaço. Sem isso o áudio vira ruído.
        // Anotado: alloc devolve Buffer<ArrayBuffer> e subarray devolve
        // Buffer<ArrayBufferLike>, e os dois se alternam nesta variável.
        let leftover: Buffer<ArrayBufferLike> = Buffer.alloc(0);

        child.stdout.on("data", (chunk: Buffer) => {
            const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
            const usable = buf.length - (buf.length % 4);
            leftover = buf.subarray(usable);

            for (let i = 0; i < usable; i += 4) {
                ring[writeAt] = buf.readFloatLE(i);
                writeAt = (writeAt + 1) % ring.length;

                if (available < ring.length) available++;
                else readAt = (readAt + 1) % ring.length; // descarta o mais velho
            }
        });

        child.stderr.on("data", (d: Buffer) =>
            console.debug("[P2PShare] helper:", d.toString().trim()));

        child.on("error", (err: Error) =>
            console.error("[P2PShare] helper falhou ao iniciar", err));

        // ScriptProcessor é depreciado, mas AudioWorklet exige carregar um
        // módulo por URL, e a política de conteúdo do Discord bloqueia isso.
        const node = context.createScriptProcessor(1024, 0, CHANNELS);

        node.onaudioprocess = event => {
            const left = event.outputBuffer.getChannelData(0);
            const right = event.outputBuffer.getChannelData(1);

            for (let i = 0; i < left.length; i++) {
                if (available >= CHANNELS) {
                    left[i] = ring[readAt];
                    right[i] = ring[(readAt + 1) % ring.length];
                    readAt = (readAt + CHANNELS) % ring.length;
                    available -= CHANNELS;
                } else {
                    // Sem dados ainda: silêncio é melhor que repetir o passado.
                    left[i] = 0;
                    right[i] = 0;
                }
            }
        };

        node.connect(destination);

        const track = destination.stream.getAudioTracks()[0];
        if (!track) throw new Error("o contexto de áudio não produziu trilha");

        const stop = () => {
            try {
                child.kill();
            } catch { /* já morreu */ }
            node.disconnect();
            void context.close();
        };

        // Se o helper morrer sozinho, não deixar o contexto pendurado.
        child.on("exit", () => {
            node.onaudioprocess = null;
        });

        return { track, stop };
    } catch (err) {
        console.error("[P2PShare] não deu para capturar áudio isolado", err);
        BdApi.UI.showToast(
            `Áudio isolado indisponível: ${(err as Error).message}`,
            { type: "error" }
        );
        return null;
    }
}
