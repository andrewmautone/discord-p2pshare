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

/**
 * Inicia um processo sem `child_process`.
 *
 * O `require` do BetterDiscord atende uma lista fixa de módulos e tenta
 * resolver o resto como caminho de arquivo — `child_process` fica de fora, e
 * a falha aparece como um ENOENT apontando para dentro da pasta do Discord.
 * O `process.mainModule`, que daria o require original, não existe no
 * renderer do Discord.
 *
 * Sobram as ligações de baixo nível, que continuam acessíveis: são as mesmas
 * que o próprio `child_process` usa por baixo. Verificado antes de escrever
 * isto — spawn retorna 0 e o stdout chega inteiro.
 */
export interface HelperProcess {
    onData(handler: (data: Uint8Array) => void): void;
    onExit(handler: () => void): void;
    kill(): void;
}

function spawnHelper(exe: string, args: string[]): HelperProcess {
    const { Process } = (process as any).binding("process_wrap");
    const pipeWrap = (process as any).binding("pipe_wrap");

    const stdout = new pipeWrap.Pipe(pipeWrap.constants.SOCKET);
    const child = new Process();

    let onData: (data: Uint8Array) => void = () => { };
    let onExit: () => void = () => { };
    let alive = true;

    // A assinatura mudou entre versões do Node: ora o buffer vem no primeiro
    // argumento, ora no segundo com a contagem no primeiro.
    stdout.onread = (first: unknown, second?: Uint8Array) => {
        const data = typeof first === "number" ? second : (first as Uint8Array);
        if (data && data.byteLength) onData(new Uint8Array(data));
    };

    child.onexit = () => {
        alive = false;
        onExit();
    };

    const code = child.spawn({
        file: exe,
        // argv[0] é o próprio programa, como todo processo espera.
        args: [exe, ...args],
        cwd: undefined,
        windowsHide: true,
        windowsVerbatimArguments: false,
        detached: false,
        envPairs: Object.entries(process.env).map(([k, v]) => `${k}=${v}`),
        stdio: [
            { type: "ignore" },
            { type: "pipe", handle: stdout, readable: false, writable: true },
            { type: "ignore" }
        ]
    });

    if (code !== 0) throw new Error(`não deu para iniciar o componente (código ${code})`);

    stdout.readStart();

    return {
        onData: handler => { onData = handler; },
        onExit: handler => { onExit = handler; },
        kill: () => {
            if (!alive) return;
            alive = false;
            try {
                child.kill();
            } catch { /* já morreu */ }
            try {
                stdout.close();
            } catch { /* idem */ }
        }
    };
}

const HELPER_NAME = "p2pshare-audio.exe";
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
/** ~1s de folga: absorve engasgo do pipe sem atrasar demais o áudio. */
const RING_FRAMES = SAMPLE_RATE;

function helperPath(): string {
    const path = require("path");
    return path.join(BdApi.Plugins.folder, HELPER_NAME);
}

/**
 * Baixa um arquivo por fora da política de conteúdo do Discord.
 *
 * O `fetch` do renderer é barrado: o download de release do GitHub redireciona
 * para outro host, e a política recusa — chega um "Failed to fetch" mudo. O
 * `BdApi.Net.fetch` sai pelo processo principal, onde essa política não vale,
 * e devolve uma Response comum.
 *
 * O módulo `https` do Node não serve aqui: o BetterDiscord o substitui por um
 * shim que não tem a interface de stream do Node.
 */
async function downloadBuffer(url: string): Promise<Uint8Array> {
    const net = BdApi.Net?.fetch;

    // BetterDiscord antigo, sem BdApi.Net: tenta o fetch comum, que funciona
    // para hosts permitidos pela política.
    const res = net
        ? await net(url, { redirect: "follow" })
        : await fetch(url, { cache: "no-store" });

    if (!res.ok) throw new Error(`o servidor respondeu ${res.status}`);

    return new Uint8Array(await res.arrayBuffer());
}

function sha256(data: Uint8Array): string {
    return require("crypto").createHash("sha256").update(data).digest("hex");
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

/** Já instalado e na versão que este plugin espera? */
export function helperReady(): boolean {
    return localHelperIsValid();
}

let downloading: Promise<string | null> | null = null;

/**
 * Garante o binário em disco, baixando se preciso.
 *
 * Não pergunta: o componente é parte do plugin, e o JavaScript que o baixa já
 * roda com acesso total ao Node — pedir permissão só para o binário seria
 * teatro. A conferência de SHA-256 continua, que é o que protege de fato
 * contra um arquivo adulterado no caminho.
 *
 * Chamadas simultâneas compartilham o mesmo download.
 */
export function ensureHelper(): Promise<string | null> {
    if (localHelperIsValid()) return Promise.resolve(helperPath());

    downloading ??= download().finally(() => { downloading = null; });
    return downloading;
}

async function download(): Promise<string | null> {
    try {
        const buffer = await downloadBuffer(HELPER_URL);
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
        lastError = null;
        return helperPath();
    } catch (err) {
        // Sem alarde: o plugin funciona sem o componente, usando o áudio do
        // sistema. Encher a tela de erro por algo que se recupera sozinho na
        // próxima abertura só assusta.
        lastError = (err as Error).message;
        console.warn("[P2PShare] não deu para baixar o componente de áudio", err);
        recordDiagnostics();
        return null;
    }
}

let lastError: string | null = null;

/** O que impediu a instalação, para a tela de configurações contar. */
export function helperError(): string | null {
    return lastError;
}

/**
 * Grava o estado da instalação ao lado do plugin.
 *
 * O DevTools do Discord vem desligado, então sem isto quem reporta "não
 * instala" não tem como dizer por quê.
 */
function recordDiagnostics(): void {
    try {
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(
            path.join(BdApi.Plugins.folder, "p2pshare-audio-debug.json"),
            JSON.stringify({
                quando: new Date().toISOString(),
                url: HELPER_URL,
                hashEsperado: HELPER_SHA256,
                pastaDePlugins: BdApi.Plugins.folder,
                arquivoExiste: helperFileExists(),
                erro: lastError
            }, null, 2),
            "utf8"
        );
    } catch (err) {
        console.warn("[P2PShare] não deu para gravar o diagnóstico de áudio", err);
    }
}

/**
 * Instala ou atualiza o componente, em segundo plano.
 *
 * Roda na inicialização. É por aqui que quem vinha de uma versão sem o
 * componente passa a tê-lo: o plugin se atualiza sozinho, e o JavaScript novo
 * traz o hash novo, que não bate com o que está em disco — ou com a ausência
 * dele — e dispara a busca.
 */
export async function syncHelper(): Promise<void> {
    if (localHelperIsValid()) return;

    const hadOldVersion = helperFileExists();
    const path = await ensureHelper();

    if (path && hadOldVersion) {
        console.info("[P2PShare] componente de áudio atualizado");
    }
}

function helperFileExists(): boolean {
    try {
        return require("fs").existsSync(helperPath());
    } catch {
        return false;
    }
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
    const exe = await ensureHelper();
    if (!exe) return [];

    return new Promise(resolve => {
        try {
            const child = spawnHelper(exe, ["--list"]);

            let out = "";
            child.onData(d => { out += new TextDecoder().decode(d); });
            child.onExit(() => {
                try {
                    resolve(JSON.parse(out.trim() || "[]"));
                } catch {
                    resolve([]);
                }
            });
        } catch (err) {
            console.warn("[P2PShare] não deu para listar os programas com áudio", err);
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
    // Faltando o componente, o áudio do sistema entra no lugar sem alarde.
    const exe = await ensureHelper();
    if (!exe) {
        console.info("[P2PShare] componente de áudio ausente, usando o áudio do sistema");
        return null;
    }

    const args = await helperArgs(request);
    if (!args) return null;

    try {
        const child = spawnHelper(exe, args);

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
        let leftover = new Uint8Array(0);

        child.onData(chunk => {
            let buf = chunk;
            if (leftover.length) {
                buf = new Uint8Array(leftover.length + chunk.length);
                buf.set(leftover);
                buf.set(chunk, leftover.length);
            }

            const usable = buf.length - (buf.length % 4);
            leftover = buf.slice(usable);

            const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

            for (let i = 0; i < usable; i += 4) {
                // true = little-endian, que é como o auxiliar escreve.
                ring[writeAt] = view.getFloat32(i, true);
                writeAt = (writeAt + 1) % ring.length;

                if (available < ring.length) available++;
                else readAt = (readAt + 1) % ring.length; // descarta o mais velho
            }
        });

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
            child.kill();
            node.disconnect();
            void context.close();
        };

        // Se o helper morrer sozinho, não deixar o contexto pendurado.
        child.onExit(() => {
            node.onaudioprocess = null;
        });

        return { track, stop };
    } catch (err) {
        lastError = (err as Error).message;
        recordDiagnostics();
        console.error("[P2PShare] não deu para capturar áudio isolado", err);
        BdApi.UI.showToast(
            `Áudio isolado indisponível: ${(err as Error).message}`,
            { type: "error" }
        );
        return null;
    }
}
