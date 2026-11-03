/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Beacon } from "./beacon";
import { ACTIVITY_APP_ID, PROTOCOL_VERSION } from "./constants";

/**
 * Aviso de transmissão pelo status do Discord ("Jogando P2PShare").
 *
 * Substitui a mensagem no chat como caminho principal: o status chega a quem
 * está na mesma chamada sem poluir o canal, e some sozinho quando o Discord
 * fecha — não sobra aviso órfão.
 *
 * O id da sessão e o canal viajam em `party.id`, campo que o Discord repassa
 * aos outros clientes mas não mostra na interface. Módulo puro: nada aqui
 * toca no Discord.
 */

export const ACTIVITY_NAME = "P2PShare";
const PARTY_PREFIX = "p2ps";

/** Formato de atividade aceito pelo LOCAL_ACTIVITY_UPDATE do Discord. */
export interface BroadcastActivity {
    /**
     * Obrigatório: o LocalActivityStore do Discord descarta atividade local sem
     * application_id (conferido no cliente 1.0.9266).
     */
    application_id: string;
    name: string;
    /** 0 = "Jogando". */
    type: 0;
    details: string;
    state: string;
    timestamps: { start: number; };
    party: { id: string; };
    flags: number;
}

/** Sem aplicação registrada o status não sai do cliente: usa só o chat. */
export function canAnnounceByStatus(): boolean {
    return ACTIVITY_APP_ID !== "";
}

export function broadcastActivity(sessionId: string, channelId: string, startedAt: number): BroadcastActivity {
    return {
        application_id: ACTIVITY_APP_ID,
        name: ACTIVITY_NAME,
        type: 0,
        details: "🔴 Transmitindo a tela",
        state: "Clique em AO VIVO no quadro da chamada",
        timestamps: { start: startedAt },
        party: { id: `${PARTY_PREFIX}:${PROTOCOL_VERSION}:${channelId}:${sessionId}` },
        flags: 0
    };
}

/** Lê a atividade de outra pessoa. Aceita `unknown`: vem do store do Discord. */
export function parseActivity(raw: unknown): { sessionId: string; channelId: string; } | null {
    const a = raw as any;
    if (a?.name !== ACTIVITY_NAME) return null;

    const id = a?.party?.id;
    if (typeof id !== "string") return null;

    const parts = id.split(":");
    if (parts.length !== 4 || parts[0] !== PARTY_PREFIX) return null;
    if (Number(parts[1]) !== PROTOCOL_VERSION) return null;

    const [, , channelId, sessionId] = parts;
    if (!/^\d+$/.test(channelId) || !sessionId) return null;

    return { sessionId, channelId };
}

/** Prefixo dos ids sintéticos: o resto do plugin indexa beacon por messageId. */
const KEY_PREFIX = "presence:";

export function presenceKey(sessionId: string): string {
    return KEY_PREFIX + sessionId;
}

export function isPresenceKey(messageId: string): boolean {
    return messageId.startsWith(KEY_PREFIX);
}

export interface PresenceMember {
    userId: string;
    username: string;
    activities: readonly unknown[];
}

/**
 * Transmissões anunciadas pelos membros de um canal de voz.
 *
 * Só vale a atividade que aponta para o MESMO canal em que a pessoa está:
 * status velho de outra sala não pode virar aviso aqui.
 */
export function beaconsFromPresence(
    channelId: string,
    members: readonly PresenceMember[],
    excludeUserId?: string
): Beacon[] {
    const found: Beacon[] = [];

    for (const member of members) {
        if (member.userId === excludeUserId) continue;

        for (const activity of member.activities ?? []) {
            const parsed = parseActivity(activity);
            if (!parsed || parsed.channelId !== channelId) continue;

            found.push({
                messageId: presenceKey(parsed.sessionId),
                channelId,
                sessionId: parsed.sessionId,
                broadcasterId: member.userId,
                broadcasterName: member.username
            });
            break;
        }
    }

    return found;
}
