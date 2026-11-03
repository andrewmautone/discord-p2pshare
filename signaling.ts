/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { HandshakeKind } from "./codec";
import { RELAYS } from "./constants";
import { Discovery, type LiveBroadcast } from "./discovery";
import { host } from "./host";
import { P2PSHARE_KIND } from "./nostr/event";
import { RelayPool } from "./nostr/pool";

/**
 * Sinalização sem passar pelo Discord: aviso e handshake vão pelos relays
 * Nostr públicos, na sala do canal de voz. Nada no chat, em DM ou no status.
 *
 * Quem está olhando um servidor escuta todos os canais de voz dele — é assim
 * que o selo de "transmitindo" aparece na lista mesmo para quem está fora da
 * chamada.
 */

export interface Beacon {
    /** Chave única do aviso (o resto do plugin indexa por ela). */
    messageId: string;
    channelId: string;
    sessionId: string;
    broadcasterId: string;
    broadcasterName: string;
}

export interface HandshakeEvent {
    sessionId: string;
    kind: HandshakeKind;
    fromUserId: string;
    sdp: string;
}

let pool: RelayPool | null = null;
let discovery: Discovery | null = null;
let unwatchNav: (() => void) | null = null;

function ensure(): Discovery {
    if (discovery) return discovery;

    pool = new RelayPool(RELAYS, url => host.openRelaySocket(url), { kind: P2PSHARE_KIND });
    discovery = new Discovery(pool, {
        me: () => ({ id: host.getCurrentUserId(), name: host.getCurrentUsername() })
    });

    unwatchNav = host.onNavigationChange(() => { void refreshWatched(); });
    void refreshWatched();
    return discovery;
}

/**
 * Canais cujo aviso interessa: todos os de voz do servidor aberto na tela e
 * do servidor da chamada em que estou, mais a própria chamada.
 */
async function refreshWatched(): Promise<void> {
    if (!discovery) return;

    const ids = new Set<string>();
    const voice = host.getVoiceChannelId();
    const guilds = new Set<string>();

    const selected = host.getSelectedGuildId();
    if (selected) guilds.add(selected);
    if (voice) {
        ids.add(voice);
        const g = host.getChannelGuildId(voice);
        if (g) guilds.add(g);
    }
    for (const g of guilds) for (const id of host.getGuildVoiceChannelIds(g)) ids.add(id);

    await discovery.watch([...ids]);
}

export function startSignaling(): void {
    ensure();
}

export function stopSignaling(): void {
    unwatchNav?.();
    unwatchNav = null;
    discovery?.close();
    discovery = null;
    pool?.close();
    pool = null;
}

/** Anuncia a transmissão (renovando sozinho). Devolve a função que encerra. */
export function announceLive(channelId: string, sessionId: string): () => void {
    return ensure().startLive(channelId, sessionId);
}

export function sendHandshake(
    channelId: string,
    sessionId: string,
    kind: HandshakeKind,
    targetUserId: string,
    sdp: string
): Promise<void> {
    return ensure().sendSignal(channelId, sessionId, kind, targetUserId, sdp);
}

function toBeacon(live: LiveBroadcast): Beacon {
    return {
        messageId: `nostr:${live.sessionId}`,
        channelId: live.channelId,
        sessionId: live.sessionId,
        broadcasterId: live.userId,
        broadcasterName: live.name
    };
}

/**
 * Aviso que vale a pena mostrar: de outra pessoa e de quem está mesmo naquele
 * canal de voz. Sem a segunda regra, qualquer um que soubesse o id do canal
 * poderia pendurar um selo falso no nome de alguém.
 */
function believable(live: LiveBroadcast, myId: string): boolean {
    return live.userId !== myId && host.isUserInVoiceChannel(live.userId, live.channelId);
}

/** Traduz os relays em eventos de aviso e de handshake. Devolve a limpeza. */
export function observeSignals(handlers: {
    onBeacon?: (beacon: Beacon) => void;
    onBeaconGone?: (beacon: Beacon) => void;
    onHandshake?: (event: HandshakeEvent) => void;
}): () => void {
    const d = ensure();
    const myId = host.getCurrentUserId();
    let shown = new Map<string, Beacon>();

    const sync = () => {
        const next = new Map<string, Beacon>();
        for (const live of d.live()) {
            if (!believable(live, myId)) continue;
            const b = toBeacon(live);
            next.set(b.messageId, b);
        }
        for (const [key, b] of next) if (!shown.has(key)) handlers.onBeacon?.(b);
        for (const [key, b] of shown) if (!next.has(key)) handlers.onBeaconGone?.(b);
        shown = next;
    };

    const unsubLive = d.onLive(sync);
    // Quem entra ou sai da voz muda o que é crível sem mudar os avisos.
    const unsubNav = host.onNavigationChange(() => setTimeout(sync, 0));
    const unsubSignal = d.onSignal(s => {
        handlers.onHandshake?.({ sessionId: s.sessionId, kind: s.kind, fromUserId: s.fromUserId, sdp: s.sdp });
    });
    sync();

    return () => {
        unsubLive();
        unsubNav();
        unsubSignal();
    };
}
