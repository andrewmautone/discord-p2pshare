/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { selectBeacons } from "./beacon";
import { host } from "./host";
import { type PeerTransport, ViewerPeer } from "./peers";
import { type Beacon, observeSignals, sendHandshake } from "./signaling";

/** Beacons vivos, por messageId. */
const beacons = new Map<string, Beacon>();
/** Sessões que estou assistindo, por sessionId. */
const watching = new Map<string, ViewerPeer>();
/**
 * messageIds de beacons que se provaram mortos — a conexão com quem transmite
 * não abriu. A mensagem continua no histórico (o Discord de quem transmitia
 * fechou à força e nunca a apagou), então sem esta lista toda varredura do
 * canal ressuscitaria o mesmo aviso, prometendo uma transmissão que não existe.
 *
 * Uma transmissão nova posta uma mensagem nova, com id novo: quem recomeça
 * volta a ser anunciado normalmente.
 *
 * O registro expira porque a falha pode ter sido passageira — a rede oscilou,
 * o outro lado estava trocando de janela. Enterrar a transmissão até o fim da
 * sessão esconderia algo que continua no ar, e a pessoa não teria como pedir
 * de novo.
 */
const deadBeacons = new Map<string, number>();

/** Depois disto, uma transmissão que falhou pode ser redescoberta. */
const DEAD_BEACON_TTL_MS = 3 * 60 * 1000;

function isDead(messageId: string): boolean {
    const when = deadBeacons.get(messageId);
    if (when === undefined) return false;

    if (Date.now() - when < DEAD_BEACON_TTL_MS) return true;

    deadBeacons.delete(messageId);
    return false;
}

const beaconListeners = new Set<(beacons: Beacon[]) => void>();

function notifyBeacons(): void {
    const list = [...beacons.values()];
    for (const listener of beaconListeners) listener(list);
}

export function getActiveBeacons(): Beacon[] {
    return [...beacons.values()];
}

export function onBeaconsChange(listener: (beacons: Beacon[]) => void): () => void {
    beaconListeners.add(listener);
    return () => beaconListeners.delete(listener);
}

export function isWatching(sessionId: string): boolean {
    return watching.has(sessionId);
}

/** Quantas transmissões estou assistindo agora. */
export function watchingCount(): number {
    return watching.size;
}

/**
 * Registra e anuncia um beacon. Único caminho de entrada: o evento ao vivo e a
 * varredura do histórico passam os dois por aqui, então o que vale para um
 * vale para o outro.
 *
 * A deduplicação é por messageId. Sem ela, entrar e sair do canal de voz faria
 * o mesmo aviso pipocar de novo a cada varredura.
 */
function acceptBeacon(beacon: Beacon): void {
    if (beacons.has(beacon.messageId)) return;
    if (isDead(beacon.messageId)) return;

    beacons.set(beacon.messageId, beacon);
    notifyBeacons();

    syncBeaconNotices();
}

/**
 * Deixa os avisos de acordo com o canal em que estou agora.
 *
 * O beacon chega por evento de mensagem, e o Discord entrega mensagens de
 * todo canal visível — não só do canal em que estou. Sem esta regra, uma
 * transmissão em outra sala fazia barulho e abria a barra no topo de quem
 * nem estava lá.
 *
 * O selo AO VIVO continua aparecendo de fora: ver que existe transmissão é
 * diferente de ser chamado para ela.
 *
 * Idempotente de propósito: é chamada quando chega beacon, quando troco de
 * canal e depois de varrer o histórico, e as três precisam convergir para o
 * mesmo resultado.
 */
function syncBeaconNotices(): void {
    const current = host.getVoiceChannelId();

    for (const beacon of beacons.values()) {
        const aqui = current !== null && beacon.channelId === current;

        if (aqui && !watching.has(beacon.sessionId)) {
            host.announceBeacon(
                { sessionId: beacon.sessionId, broadcasterName: beacon.broadcasterName },
                () => { void startWatching(beacon); }
            );
        } else {
            // Saí do canal, ou já estou vendo: o aviso perdeu a função.
            host.revokeBeacon(beacon.sessionId);
        }
    }
}

/**
 * Reavalia os avisos depois de entrar ou sair de um canal.
 *
 * Entrar numa sala onde já havia transmissão precisa acender o aviso, e o
 * beacon pode já estar guardado de antes — nesse caso nada de novo chega, e
 * sem este empurrão a barra nunca apareceria.
 */
export function refreshBeaconNotices(): void {
    syncBeaconNotices();
}

/** Uma transmissão está no canal em que estou agora? */
export function beaconIsHere(beacon: Beacon): boolean {
    const current = host.getVoiceChannelId();
    return current !== null && beacon.channelId === current;
}

/**
 * Esquece um beacon de vez: tira o aviso da tela e marca a mensagem como
 * morta, para que nem `stopWatching` nem uma varredura futura o tragam de
 * volta.
 */
function forgetBeacon(sessionId: string): void {
    for (const [messageId, beacon] of beacons) {
        if (beacon.sessionId !== sessionId) continue;

        beacons.delete(messageId);
        deadBeacons.set(messageId, Date.now());
    }

    host.revokeBeacon(sessionId);
}

/**
 * Procura transmissões em andamento no histórico recente de um canal.
 *
 * O beacon é anunciado uma vez só, quando a mensagem chega: quem entra no
 * canal depois nunca via nada. Devolve quantos beacons novos apareceram.
 *
 * Falha em silêncio de propósito — o histórico é um complemento à descoberta
 * ao vivo, e um canal ilegível não pode atrapalhar a entrada na chamada.
 */
export async function scanChannelHistory(channelId: string, limit?: number): Promise<number> {
    if (!channelId) return 0;

    let messages;
    try {
        messages = await host.fetchRecentMessages(channelId, limit);
    } catch (err) {
        console.warn("[P2PShare] não deu para varrer o histórico do canal", err);
        return 0;
    }

    const found = selectBeacons(messages, {
        excludeAuthorId: host.getCurrentUserId(),
        knownMessageIds: [
            ...beacons.keys(),
            ...[...deadBeacons.keys()].filter(isDead)
        ]
    });

    for (const beacon of found) acceptBeacon(beacon);

    return found.length;
}

export async function startWatching(beacon: Beacon): Promise<void> {
    if (watching.has(beacon.sessionId)) return;

    const transport: PeerTransport = {
        send: (kind, targetUserId, sdp) =>
            sendHandshake(beacon.channelId, beacon.sessionId, kind, targetUserId, sdp)
    };

    const peer = new ViewerPeer(transport, beacon.broadcasterId);
    watching.set(beacon.sessionId, peer);

    // Sem isto o botão "Assistir" continua no quadro depois do clique: quem
    // recalcula a interface só era avisado de mudança de beacon.
    notifyBeacons();

    peer.onStream = stream => {
        host.mountOverlay(
            beacon.sessionId,
            stream,
            beacon.broadcasterName,
            () => stopWatching(beacon.sessionId),
            {
                closeLabel: `Parar de assistir ${beacon.broadcasterName}`,
                userId: beacon.broadcasterId
            }
        );
    };

    peer.onFailed = reason => {
        host.toast(reason, "error");

        // Beacon órfão: quem transmitia pode ter fechado o Discord à força e
        // deixado a mensagem no canal. Esquecer antes de parar impede que
        // `stopWatching` reanuncie um aviso que não leva a lugar nenhum.
        forgetBeacon(beacon.sessionId);
        stopWatching(beacon.sessionId);
    };

    try {
        await peer.start();
        host.toast(`Conectando com ${beacon.broadcasterName}…`, "info");
    } catch (err) {
        host.toast(`não deu para pedir a transmissão: ${(err as Error).message}`, "error");
        forgetBeacon(beacon.sessionId);
        stopWatching(beacon.sessionId);
    }
}

/**
 * Para de assistir. Fecha a conexão de verdade — o emissor vê você sair da
 * lista e o vídeo para de consumir banda dos dois lados.
 *
 * Se a transmissão continua no ar, o aviso volta a aparecer: sem isso, sair
 * uma vez significaria não conseguir voltar até o emissor recomeçar tudo.
 */
export function stopWatching(sessionId: string): void {
    watching.get(sessionId)?.close();
    watching.delete(sessionId);
    host.unmountOverlay(sessionId);

    // A interface precisa saber para trazer o botão de volta.
    notifyBeacons();

    for (const beacon of beacons.values()) {
        if (beacon.sessionId !== sessionId) continue;

        host.announceBeacon(
            { sessionId: beacon.sessionId, broadcasterName: beacon.broadcasterName },
            () => { void startWatching(beacon); }
        );
        return;
    }
}

/** Assina o chat para descobrir beacons e receber answers. Devolve a limpeza. */
export function initWatcher(): () => void {
    const myId = host.getCurrentUserId();

    const unsubscribe = observeSignals({
        onBeacon: beacon => {
            // Meu próprio beacon não me interessa como viewer.
            if (beacon.broadcasterId === myId) return;

            acceptBeacon(beacon);
        },

        onBeaconGone: (_channelId, messageId) => {
            const beacon = beacons.get(messageId);
            if (!beacon) return;

            beacons.delete(messageId);
            host.revokeBeacon(beacon.sessionId);
            stopWatching(beacon.sessionId);
            notifyBeacons();
        },

        onHandshake: event => {
            if (event.kind !== "answer") return;

            watching.get(event.sessionId)
                ?.handleAnswer(event.sdp)
                .catch(err => console.error("[P2PShare] answer inválida", err));
        }
    });

    return () => {
        unsubscribe();

        // Esvaziar os beacons ANTES de parar de assistir: stopWatching
        // re-anuncia transmissões ainda no ar, e no desligamento do plugin
        // isso deixaria avisos órfãos na tela.
        for (const beacon of beacons.values()) host.revokeBeacon(beacon.sessionId);
        beacons.clear();
        deadBeacons.clear();

        for (const sessionId of [...watching.keys()]) stopWatching(sessionId);
        host.unmountAllOverlays();
        notifyBeacons();
    };
}
