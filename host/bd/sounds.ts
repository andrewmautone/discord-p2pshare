/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare const BdApi: any;

/**
 * Os sons de transmissão do próprio Discord.
 *
 * A transmissão daqui é paralela à do Discord: ele não sabe que ela existe e
 * portanto não toca nada. Sintetizar um som próprio soaria estranho no meio de
 * um cliente que já tem identidade sonora — então usamos os mesmos arquivos que
 * o Discord tocaria se a transmissão fosse dele, pelo mesmo caminho interno,
 * o que também faz o plugin herdar de graça o soundpack escolhido, o volume de
 * notificação e o "desativar sons" do usuário.
 *
 * Nada aqui pode escapar: som é enfeite, transmissão é o produto. Toda falha
 * morre em silêncio e o diagnóstico vai para disco, porque o DevTools do
 * Discord vem desligado e sem isso não há como saber o que não foi encontrado.
 */

/**
 * Nomes conferidos no bundle do Discord, não adivinhados.
 *
 * O próprio Discord decide qual som tocar com estes literais, num store que
 * compara o estado do canal de voz antes e depois: quando aparece um streamer
 * novo é `stream_started`, e quando a contagem de espectadores da transmissão
 * ativa sobe é `stream_user_joined`. São exatamente os dois momentos daqui.
 */
const SOUND_STREAM_STARTED = "stream_started";
const SOUND_VIEWER_JOINED = "stream_user_joined";

/**
 * Marca do playSound minificado.
 *
 * Os exports do módulo de som são mangleados (`Ak`, `Qh`, `aN`), então procurar
 * pela propriedade `playSound` só acha builds antigos. O corpo da função, esse
 * sobrevive à minificação: ela registra este aviso quando o soundpack pedido
 * não existe, e nenhuma outra função do bundle faz isso.
 */
const PLAY_SOUND_MARKER = "Unable to find sound for pack name";

/** Os três exports mangleados do SoundUtils, na ordem em que ele os declara. */
const MANGLED_KEYS = ["Ak", "Qh", "aN"];

type Player = (name: string) => void;

interface Strategy {
    name: string;
    resolve: () => Player | null;
}

function getModule(filter: (m: any) => boolean, options?: any): any {
    return BdApi.Webpack?.getModule?.(filter, options);
}

/**
 * Valores de um objeto de exports sem confiar nele.
 *
 * Export do webpack costuma ser getter, e getter de módulo ainda não carregado
 * lança. Uma exceção aqui derrubaria a varredura inteira no meio.
 */
function safeValues(m: any): any[] {
    const out: any[] = [];

    try {
        for (const key of Object.keys(m)) {
            try {
                out.push(m[key]);
            } catch { /* export que não gosta de ser lido */ }
        }
    } catch { /* nem enumerável é */ }

    return out;
}

function isFunction(value: any): boolean {
    return typeof value === "function";
}

/** A função contém este trecho no corpo? */
function hasSource(fn: any, marker: string): boolean {
    try {
        return isFunction(fn) && Function.prototype.toString.call(fn).includes(marker);
    } catch {
        return false;
    }
}

/**
 * As estratégias, da mais específica para a mais grosseira.
 *
 * A primeira que servir vence. Não dá para testar nenhuma delas aqui — o
 * webpack do Discord só existe com o cliente rodando — então a ordem é a defesa:
 * o que casa por nome ou por corpo de função vem antes do que casa por formato,
 * e o caminho que ignora as preferências do usuário fica por último.
 */
/**
 * Fica de fora daqui a classe `WebAudioSound`, que o playSound instancia por
 * baixo. O nome dela sobrevive à minificação e seria uma quarta rede, mas
 * usá-la pula o soundpack e o "desativar sons" — tocaria para quem pediu
 * silêncio. Quando a alternativa é desrespeitar essa escolha, não tocar é a
 * resposta certa.
 */
const STRATEGIES: Strategy[] = [
    {
        // Builds em que o export ainda se chama playSound. Barato e exato,
        // então é o primeiro mesmo sendo o menos provável hoje.
        name: "playSound-nomeado",
        resolve() {
            const mod = getModule((m: any) => isFunction(m?.playSound));
            if (!mod) return null;

            return name => mod.playSound(name, 1);
        }
    },
    {
        // Mesmo módulo, nome apagado pela minificação: reconhecido pelo aviso
        // que só ele emite.
        name: "playSound-por-corpo",
        resolve() {
            let found: any = null;

            getModule((m: any) => {
                if (typeof m !== "object" || m === null) return false;

                const fn = safeValues(m).find(v => hasSource(v, PLAY_SOUND_MARKER));
                if (!fn) return false;

                found = fn;
                return true;
            });

            if (!found) return null;

            return name => found(name, 1);
        }
    },
    {
        // Os nomes mangleados atuais. Exigir o conjunto exato de três chaves,
        // todas funções, evita casar com qualquer módulo que por acaso tenha um
        // `Ak` — mas o mangle muda a cada build do Discord, daí vir depois das
        // buscas que não dependem dele.
        name: "SoundUtils-mangleado",
        resolve() {
            const mod = getModule((m: any) => {
                if (typeof m !== "object" || m === null) return false;

                const keys = Object.keys(m);
                return keys.length === MANGLED_KEYS.length
                    && MANGLED_KEYS.every(k => keys.includes(k))
                    && MANGLED_KEYS.every(k => isFunction(m[k]));
            });

            if (!mod) return null;

            return name => mod.Ak(name, 1);
        }
    }
];

let player: Player | null = null;
let attempts = 0;

/**
 * Quantas varreduras de webpack toleramos antes de desistir de vez.
 *
 * Procurar módulo é caro e estes eventos são raros, então algumas tentativas
 * cabem: o plugin carrega antes de partes do Discord existirem, e o que não foi
 * encontrado na primeira transmissão pode estar lá na segunda. Depois disso é
 * teimosia — se não apareceu, não vai aparecer.
 */
const MAX_ATTEMPTS = 3;

/**
 * Resolve o tocador na primeira chamada, não na importação.
 *
 * O plugin sobe antes do Discord terminar de montar seus módulos; procurar no
 * topo do arquivo acharia o vazio e cristalizaria a falha.
 */
function getPlayer(): Player | null {
    if (player) return player;
    if (attempts >= MAX_ATTEMPTS) return null;

    attempts++;

    for (const strategy of STRATEGIES) {
        try {
            const found = strategy.resolve();
            if (!found) continue;

            player = found;
            recordDiagnostics(strategy.name, null);
            return player;
        } catch (err) {
            // Uma estratégia que explode não pode impedir as seguintes de
            // tentar: o registro fica para a última, se ninguém servir.
            lastError = (err as Error)?.message ?? String(err);
        }
    }

    recordDiagnostics(null, lastError ?? "nenhuma estratégia encontrou o módulo de som");
    return null;
}

let lastError: string | null = null;

/**
 * Deixa em disco o que foi encontrado, ao lado do plugin.
 *
 * Só dá para conferir isto no cliente real — aqui não há webpack para
 * inspecionar. O arquivo é o substituto do console que o usuário não tem.
 */
function recordDiagnostics(strategy: string | null, error: string | null): void {
    try {
        const fs = require("fs");
        const path = require("path");

        fs.writeFileSync(
            path.join(BdApi.Plugins.folder, "p2pshare-sounds-debug.json"),
            JSON.stringify({
                quando: new Date().toISOString(),
                estrategiaQueCasou: strategy,
                tentativas: attempts,
                // Distingue "achei o módulo certo" de "achei algo parecido":
                // hoje o esperado é false, porque o export está mangleado.
                temPlaySoundNomeado: strategy === "playSound-nomeado",
                sons: {
                    transmissaoIniciada: SOUND_STREAM_STARTED,
                    espectadorEntrou: SOUND_VIEWER_JOINED
                },
                erro: error
            }, null, 2),
            "utf8"
        );
    } catch { /* diagnóstico é acessório: nem ele pode fazer barulho */ }
}

function play(name: string): void {
    try {
        getPlayer()?.(name);
    } catch (err) {
        // Módulo encontrado mas com assinatura diferente da esperada. Perde-se
        // o som, não a transmissão.
        lastError = (err as Error)?.message ?? String(err);
        player = null;
        console.warn("[P2PShare] não deu para tocar o som", err);
    }
}

/** Alguém no canal começou a transmitir. */
export function playStreamStarted(): void {
    play(SOUND_STREAM_STARTED);
}

/** Alguém entrou para assistir à minha transmissão. */
export function playViewerJoined(): void {
    play(SOUND_VIEWER_JOINED);
}

/**
 * Resolve o tocador antes do primeiro som.
 *
 * A estratégia que casa no Discord atual varre os módulos chamando `toString`
 * em cada export — caro, e pago inteiro na primeira chamada. Pagar isso no
 * instante em que a transmissão começa atrasaria justamente o som que deveria
 * marcar aquele instante.
 *
 * De brinde, é o que faz o diagnóstico existir antes de alguém transmitir.
 */
export function warmSounds(): void {
    try {
        getPlayer();
    } catch { /* aquecer nunca pode atrapalhar a subida do plugin */ }
}
