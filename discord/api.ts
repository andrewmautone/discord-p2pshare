/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CloudUpload as TCloudUpload } from "@vencord/discord-types";
import { CloudUploadPlatform } from "@vencord/discord-types/enums";
import { findLazy } from "@webpack";
import { Constants, MessageStore, RestAPI, SelectedChannelStore, SnowflakeUtils, UserStore } from "@webpack/common";

const CloudUpload: typeof TCloudUpload = findLazy(m => m.prototype?.trackUploadFinished);

export interface DiscordMessage {
    id: string;
    channel_id: string;
    content: string;
    author: { id: string; username: string; };
    attachments?: { filename: string; url: string; }[];
}

export function getCurrentUserId(): string {
    return UserStore.getCurrentUser().id;
}

export function getCurrentUsername(): string {
    return UserStore.getCurrentUser().username;
}

/**
 * Nome de exibição de um usuário qualquer.
 *
 * Quem acabou de entrar no canal pode ainda não estar no store — nesse caso
 * mostrar o id cru é melhor que quebrar a lista inteira.
 */
export function getUsername(userId: string): string {
    const user = UserStore.getUser(userId) as any;
    return user?.globalName || user?.username || userId;
}

/** Canal de voz em que o usuário está, ou null. */
export function getVoiceChannelId(): string | null {
    return SelectedChannelStore.getVoiceChannelId() ?? null;
}

export async function sendMessage(channelId: string, content: string): Promise<string> {
    const res = await RestAPI.post({
        url: Constants.Endpoints.MESSAGES(channelId),
        body: {
            channel_id: channelId,
            content,
            nonce: SnowflakeUtils.fromTimestamp(Date.now()),
            sticker_ids: [],
            type: 0
        }
    });

    return res.body.id as string;
}

const dmCache = new Map<string, string>();

/**
 * Abre (ou reusa) a DM com um usuário e devolve o id do canal.
 *
 * Devolve null quando o Discord recusa — DM fechada, bloqueio, sem servidor
 * em comum. Quem chama trata isso como "use o canal público".
 *
 * O id é memoizado: o Discord devolve sempre o mesmo canal, e cada handshake
 * faria uma chamada à toa.
 */
export async function openDm(userId: string): Promise<string | null> {
    const cached = dmCache.get(userId);
    if (cached) return cached;

    try {
        const res = await RestAPI.post({
            url: "/users/@me/channels",
            body: { recipient_id: userId }
        });

        const id = res.body?.id as string | undefined;
        if (!id) return null;

        dmCache.set(userId, id);
        return id;
    } catch (err) {
        console.warn("[P2PShare] não deu para abrir DM", err);
        return null;
    }
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
    await RestAPI.del({ url: Constants.Endpoints.MESSAGE(channelId, messageId) });
}

/**
 * Sobe um arquivo de texto e posta a mensagem que o referencia.
 *
 * Mesmo caminho do plugin voiceMessages: CloudUpload sobe o arquivo, e só
 * depois do evento "complete" a mensagem é postada apontando para o
 * uploadedFilename que o Discord devolveu.
 */
export function uploadTextAttachment(
    channelId: string,
    filename: string,
    text: string,
    content: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        const upload = new CloudUpload({
            file: new File([text], filename, { type: "text/plain" }),
            isThumbnail: false,
            platform: CloudUploadPlatform.WEB
        }, channelId);

        upload.on("complete", () => {
            RestAPI.post({
                url: Constants.Endpoints.MESSAGES(channelId),
                body: {
                    channel_id: channelId,
                    content,
                    nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                    sticker_ids: [],
                    type: 0,
                    attachments: [{
                        id: "0",
                        filename: upload.filename,
                        uploaded_filename: upload.uploadedFilename
                    }]
                }
            }).then(() => resolve(), reject);
        });

        upload.on("error", () => reject(new Error("falha ao subir o anexo")));

        upload.upload();
    });
}

/** Quantas mensagens olhar para trás ao varrer um canal. */
const HISTORY_LIMIT = 50;

/**
 * Mensagens recentes do canal, da mais nova para a mais antiga.
 *
 * Tenta primeiro o cache do Discord, instantâneo e sem custo de rede; só
 * busca de verdade quando o canal ainda não foi carregado. Nunca propaga
 * erro: a varredura é um extra sobre a descoberta ao vivo.
 */
export async function fetchRecentMessages(
    channelId: string,
    limit: number = HISTORY_LIMIT
): Promise<DiscordMessage[]> {
    try {
        const cache = MessageStore.getMessages(channelId) as any;

        if (cache?.ready !== false) {
            // O cache guarda da mais antiga para a mais nova; invertemos para
            // que as duas estratégias entreguem a mesma ordem.
            const list: any[] = Array.isArray(cache?._array)
                ? cache._array
                : typeof cache?.toArray === "function" ? cache.toArray() ?? [] : [];

            const normalized = normalizeMessages(list.slice(-limit).reverse(), channelId);
            if (normalized.length > 0) return normalized;
        }
    } catch (err) {
        console.warn("[P2PShare] cache de mensagens indisponível", err);
    }

    try {
        const res = await RestAPI.get({
            url: `${Constants.Endpoints.MESSAGES(channelId)}?limit=${limit}`
        });

        return normalizeMessages(res?.body, channelId).slice(0, limit);
    } catch (err) {
        console.warn("[P2PShare] não deu para buscar o histórico do canal", err);
        return [];
    }
}

function normalizeMessages(raw: any, channelId: string): DiscordMessage[] {
    if (!Array.isArray(raw)) return [];

    const out: DiscordMessage[] = [];

    for (const m of raw) {
        if (typeof m?.id !== "string" || typeof m?.content !== "string") continue;
        if (typeof m?.author?.id !== "string") continue;

        out.push({
            id: m.id,
            // Registro de cache nem sempre carrega o canal; sem ele o
            // handshake sairia sem destino, então o canal pedido é a verdade.
            channel_id: m.channel_id ?? m.channelId ?? channelId,
            content: m.content,
            author: { id: m.author.id, username: m.author.username ?? m.author.id },
            attachments: Array.isArray(m.attachments) ? m.attachments : []
        });
    }

    return out;
}

export async function fetchAttachmentText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`anexo respondeu ${res.status}`);
    return res.text();
}
