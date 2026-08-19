/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { toBytes } from "../../binary";
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
 * Endereço do servidor local do auxiliar.
 *
 * O auxiliar deixou de escrever no stdout porque o stdout deixou de ser
 * alcançável: iniciar processo a partir do BetterDiscord exigia
 * `child_process`, que ele não entrega, e a via alternativa — as ligações
 * internas do Node — derruba o Discord, porque no Node 24 elas abortam o
 * processo em vez de lançar exceção. Isso foi reproduzido, não suposto.
 *
 * Sobrou `shell.openPath`, que inicia um programa mas não passa argumentos
 * nem dá stdout. Então o auxiliar sobe um servidor HTTP em 127.0.0.1 e o
 * plugin fala com ele por ali — a política de conteúdo do Discord libera esse
 * destino, inclusive com leitura incremental.
 */
interface HelperEndpoint {
    port: number;
    token: string;
}

function beside(name: string): string {
    return require("path").join(BdApi.Plugins.folder, name);
}

/**
 * Segredo de uso único por sessão.
 *
 * O modo de captura pode viajar na URL; a permissão não. Sem segredo,
 * qualquer programa da máquina poderia pedir o áudio ao auxiliar.
 */
function newToken(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function request(
    ep: HelperEndpoint,
    path: string,
    params: Record<string, string> = {},
    signal?: AbortSignal
): Promise<Response> {
    const query = new URLSearchParams({ token: ep.token, ...params });
    return fetch(`http://127.0.0.1:${ep.port}${path}?${query}`, { signal });
}

/** O processo que anunciou esta porta ainda é o nosso? */
async function alive(ep: HelperEndpoint): Promise<boolean> {
    try {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 1500);
        const res = await request(ep, "/ping", {}, abort.signal);
        clearTimeout(timer);
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * Espera o auxiliar anunciar em qual porta subiu.
 *
 * `shell.openPath` volta assim que o Windows aceita iniciar o programa, muito
 * antes de ele estar ouvindo. O arquivo de porta é o aperto de mão.
 */
async function waitForPort(deadlineMs = 8000): Promise<number> {
    const fs = require("fs");
    const file = beside("p2pshare-audio.port");
    const until = Date.now() + deadlineMs;

    while (Date.now() < until) {
        try {
            if (fs.existsSync(file)) {
                const port = parseInt(String(fs.readFileSync(file, "utf8")).trim(), 10);
                if (port > 0) return port;
            }
        } catch { /* ainda escrevendo */ }

        await new Promise(r => setTimeout(r, 100));
    }

    // O auxiliar não tem console: se desistiu, deixou o motivo em disco.
    let motivo = "";
    try {
        motivo = String(fs.readFileSync(beside("p2pshare-audio.log"), "utf8")).trim();
    } catch { /* sem log, sem motivo */ }

    throw new Error(motivo || "o componente de áudio não respondeu a tempo");
}

let endpoint: HelperEndpoint | null = null;
let starting: Promise<HelperEndpoint | null> | null = null;

async function startServer(): Promise<HelperEndpoint | null> {
    const exe = await ensureHelper();
    if (!exe) return null;

    const fs = require("fs");
    const token = newToken();

    fs.writeFileSync(beside("p2pshare-audio.token"), token, "utf8");

    // Porta velha de um processo já encerrado enganaria a espera abaixo.
    for (const resto of ["p2pshare-audio.port", "p2pshare-audio.log"]) {
        try {
            if (fs.existsSync(beside(resto))) fs.unlinkSync(beside(resto));
        } catch { /* segue */ }
    }

    const { shell } = require("electron");

    // Devolve string vazia quando deu certo, e a mensagem de erro quando não.
    const problema = await shell.openPath(exe);
    if (problema) throw new Error(problema);

    return { port: await waitForPort(), token };
}

/**
 * O servidor do auxiliar, subindo-o se preciso.
 *
 * Ele sai sozinho depois de um tempo ocioso, então encontrar um endereço
 * guardado não garante que ele exista — daí a confirmação antes de reusar.
 */
async function helperEndpoint(): Promise<HelperEndpoint | null> {
    if (endpoint && await alive(endpoint)) return endpoint;

    // Chamadas simultâneas não podem subir dois processos.
    starting ??= startServer()
        .then(ep => { endpoint = ep; return ep; })
        .catch(err => {
            lastError = (err as Error).message;
            recordDiagnostics();
            console.warn("[P2PShare] não deu para iniciar o componente de áudio", err);
            return null;
        })
        .finally(() => { starting = null; });

    return starting;
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

/**
 * Lê um arquivo como bytes, sem confiar no encoding padrão.
 *
 * O `fs` do BetterDiscord devolve texto UTF-8 quando não se pede encoding, o
 * que corrompe binário. Aqui cada tentativa é conferida contra o tamanho que
 * o próprio sistema de arquivos informa: só passa a que devolver a contagem
 * exata, então um shim que ignore o pedido é descartado em vez de produzir um
 * hash errado em silêncio.
 */
function readBinaryFile(file: string): Uint8Array {
    const fs = require("fs");
    const { size } = fs.statSync(file);

    const tentativas = [
        () => fs.readFileSync(file, { encoding: null }),
        () => fs.readFileSync(file, "latin1"),
        () => fs.readFileSync(file)
    ];

    for (const ler of tentativas) {
        try {
            const bytes = toBytes(ler());
            if (bytes.length === size) return bytes;
        } catch { /* tenta a próxima forma */ }
    }

    throw new Error(`não deu para ler ${size} bytes de ${file} sem corromper`);
}

/**
 * Por que a última conferência reprovou o arquivo.
 *
 * A conferência engolia o motivo: arquivo ausente, hash diferente e exceção
 * ao ler viravam o mesmo `false`, e a tela só sabia dizer "não instalado".
 * Com um binário correto em disco sendo recusado, essa distinção é o que
 * separa investigar de adivinhar.
 */
let lastValidityProblem: string | null = null;

/** O arquivo em disco é mesmo o binário que publicamos? */
function localHelperIsValid(): boolean {
    let file = "(caminho não resolvido)";

    try {
        const fs = require("fs");
        file = helperPath();

        if (!fs.existsSync(file)) {
            lastValidityProblem = `não existe: ${file}`;
            return false;
        }

        const bytes = readBinaryFile(file);
        const digest = sha256(bytes);

        if (digest !== HELPER_SHA256) {
            lastValidityProblem =
                `hash diferente (${bytes.length} bytes): disco ${digest.slice(0, 12)}, ` +
                `esperado ${HELPER_SHA256.slice(0, 12)}`;
            return false;
        }

        lastValidityProblem = null;
        return true;
    } catch (err) {
        lastValidityProblem =
            `erro ao conferir ${file}: ${(err as Error)?.message ?? String(err)}`;
        return false;
    }
}

/**
 * Já instalado e na versão que este plugin espera?
 *
 * Limpa o registro de erro quando encontra o arquivo certo: uma falha antiga
 * — de antes de o instalador colocar o componente, por exemplo — não pode
 * seguir aparecendo na tela depois de resolvida.
 */
export function helperReady(): boolean {
    const valid = localHelperIsValid();

    if (valid && lastError) {
        lastError = null;
        clearDiagnostics();
    }

    return valid;
}

function clearDiagnostics(): void {
    try {
        const fs = require("fs");
        const path = require("path");
        const file = path.join(BdApi.Plugins.folder, "p2pshare-audio-debug.json");
        if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch { /* diagnóstico é acessório */ }
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
                motivoDaRecusa: lastValidityProblem,
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
/** Remove o componente do disco, a pedido do usuário. */
export function removeHelper(): boolean {
    try {
        const fs = require("fs");
        if (fs.existsSync(helperPath())) fs.unlinkSync(helperPath());
        lastError = null;
        return true;
    } catch (err) {
        lastError = (err as Error).message;
        console.warn("[P2PShare] não deu para remover o componente", err);
        return false;
    }
}

export async function syncHelper(): Promise<void> {
    if (localHelperIsValid()) return;

    // Registra antes de tentar baixar: se o download der certo, o motivo da
    // recusa se perde, e é justamente ele que interessa quando o arquivo em
    // disco parece correto.
    recordDiagnostics();

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
    const ep = await helperEndpoint();
    if (!ep) return [];

    try {
        const res = await request(ep, "/apps");
        if (!res.ok) throw new Error(`o componente respondeu ${res.status}`);

        return await res.json();
    } catch (err) {
        console.warn("[P2PShare] não deu para listar os programas com áudio", err);
        return [];
    }
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
/**
 * Traduz a fonte escolhida em argumentos para o auxiliar.
 *
 * O seletor devolve "window:<hwnd>:<n>" ou "screen:<id>:<n>". Janela vira
 * captura só do programa dono dela; monitor vira tudo menos o Discord, que é
 * o que evita devolver a chamada de voz para quem assiste.
 */
function pcmParams(sourceId: string): Record<string, string> {
    const [kind, handle] = sourceId.split(":");

    if (kind === "window" && handle) {
        return { mode: "window", target: handle };
    }

    return { mode: "exclude", target: String(discordTreePid()) };
}

export async function captureIsolatedAudio(
    sourceId: string
): Promise<IsolatedAudio | null> {
    // Faltando o componente, o áudio do sistema entra no lugar sem alarde.
    const ep = await helperEndpoint();
    if (!ep) {
        console.info("[P2PShare] componente de áudio ausente, usando o áudio do sistema");
        return null;
    }

    try {
        // Abortar é como se diz ao auxiliar que a transmissão acabou: a
        // conexão cai, a escrita dele falha, e ele encerra a captura.
        const abort = new AbortController();
        const res = await request(ep, "/pcm", pcmParams(sourceId), abort.signal);

        if (!res.ok || !res.body) {
            throw new Error(`o componente respondeu ${res.status}`);
        }

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

        const alimenta = (chunk: Uint8Array) => {
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
        };

        // Leitura incremental: os pedaços chegam conforme o auxiliar captura,
        // e o laço termina quando alguém dos dois lados desiste.
        const reader = res.body.getReader();
        void (async () => {
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) alimenta(new Uint8Array(value));
                }
            } catch {
                // Abortado pelo stop, ou o auxiliar saiu. Os dois são fim
                // normal de transmissão, não erro a relatar.
            }
        })();

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
            abort.abort();
            node.onaudioprocess = null;
            node.disconnect();
            void context.close();
        };

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
