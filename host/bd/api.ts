/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { HostMessage } from "../types";

declare const BdApi: any;

/**
 * Acesso aos módulos internos do Discord pelo BetterDiscord.
 *
 * Cada lookup é preguiçoso e memoizado: procurar no webpack é caro, e no
 * momento em que o plugin carrega nem todos os módulos existem ainda.
 *
 * Um mesmo módulo pode estar exposto de formas diferentes conforme a versão do
 * Discord — direto no export, dentro de `default`, ou só alcançável varrendo
 * os exports um a um. Por isso cada busca tenta várias estratégias antes de
 * desistir, e o erro diz QUAL módulo faltou: sem o nome, o stack trace do
 * BetterDiscord não permite diagnosticar nada.
 */
const { getModule } = BdApi.Webpack;

type Filter = (m: any) => boolean;

function find(name: string, filter: Filter): () => any {
    let cached: any;

    return () => {
        if (cached !== undefined) return cached;

        // 1. export direto
        cached = getModule(filter);

        // 2. varrendo cada export do módulo
        if (cached === undefined) {
            cached = getModule(filter, { searchExports: true });
        }

        // 3. módulo cujo conteúdo real está em `default`
        if (cached === undefined) {
            const wrapper = getModule((m: any) => m?.default && filter(m.default));
            if (wrapper) cached = wrapper.default;
        }

        if (cached === undefined || cached === null) {
            throw new Error(
                `[P2PShare] não encontrei o módulo ${name} no Discord. ` +
                "Provavelmente o Discord mudou a estrutura interna — reporte com este nome."
            );
        }

        return cached;
    };
}

const UserStore = find("UserStore",
    m => m?.getCurrentUser && m?.getUser);

const SelectedChannelStore = find("SelectedChannelStore",
    m => m?.getVoiceChannelId && m?.getChannelId);

const FluxDispatcher = find("FluxDispatcher",
    m => m?.dispatch && m?.subscribe && m?.unsubscribe);

const RestAPI = find("RestAPI",
    m => typeof m === "object" && m?.del && m?.put && m?.post);

const CloudUpload = find("CloudUpload",
    m => m?.prototype?.trackUploadFinished);

/** Snowflake a partir do relógio, para o nonce da mensagem. */
function nonce(): string {
    const DISCORD_EPOCH = 1420070400000n;
    return ((BigInt(Date.now()) - DISCORD_EPOCH) << 22n).toString();
}

export function getCurrentUserId(): string {
    return UserStore().getCurrentUser().id;
}

export function getCurrentUsername(): string {
    return UserStore().getCurrentUser().username;
}

/**
 * Nome de exibição de um usuário qualquer.
 *
 * Quem acabou de entrar no canal pode ainda não estar no store — nesse caso
 * mostrar o id cru é melhor que quebrar a lista inteira.
 */
export function getUsername(userId: string): string {
    try {
        const user = UserStore().getUser(userId);
        return user?.globalName || user?.username || userId;
    } catch {
        return userId;
    }
}

export function getVoiceChannelId(): string | null {
    return SelectedChannelStore().getVoiceChannelId() ?? null;
}

export async function sendMessage(channelId: string, content: string): Promise<string> {
    const res = await RestAPI().post({
        url: `/channels/${channelId}/messages`,
        body: {
            channel_id: channelId,
            content,
            nonce: nonce(),
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
        const res = await RestAPI().post({
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
    await RestAPI().del({ url: `/channels/${channelId}/messages/${messageId}` });
}

/**
 * Sobe um .txt e posta a mensagem que o referencia.
 *
 * Mesmo caminho da versão Vencord: o CloudUpload do Discord sobe o arquivo e
 * devolve o `uploadedFilename`, que a mensagem então referencia.
 */
export function uploadTextAttachment(
    channelId: string,
    filename: string,
    text: string,
    content: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        const Upload = CloudUpload() as any;

        const upload = new Upload({
            file: new File([text], filename, { type: "text/plain" }),
            isThumbnail: false,
            platform: 1
        }, channelId);

        upload.on("complete", () => {
            RestAPI().post({
                url: `/channels/${channelId}/messages`,
                body: {
                    channel_id: channelId,
                    content,
                    nonce: nonce(),
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

export async function fetchAttachmentText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`anexo respondeu ${res.status}`);
    return res.text();
}

export function onMessageCreate(handler: (message: HostMessage) => void): () => void {
    const listener = (event: { message: HostMessage; }) => {
        try {
            handler(event.message);
        } catch (err) {
            console.error("[P2PShare] handler de MESSAGE_CREATE falhou", err);
        }
    };

    FluxDispatcher().subscribe("MESSAGE_CREATE", listener);
    return () => FluxDispatcher().unsubscribe("MESSAGE_CREATE", listener);
}


/**
 * Entrada, saida e troca de canal de voz.
 *
 * O Discord dispara VOICE_CHANNEL_SELECT com channelId null ao desconectar.
 */
export function onVoiceChannelChange(
    handler: (channelId: string | null) => void
): () => void {
    const listener = (event: { channelId?: string | null; }) => {
        try {
            handler(event.channelId ?? null);
        } catch (err) {
            console.error("[P2PShare] handler de VOICE_CHANNEL_SELECT falhou", err);
        }
    };

    FluxDispatcher().subscribe("VOICE_CHANNEL_SELECT", listener);
    return () => FluxDispatcher().unsubscribe("VOICE_CHANNEL_SELECT", listener);
}

export function onMessageDelete(
    handler: (channelId: string, messageId: string) => void
): () => void {
    const listener = (event: { channelId: string; id: string; }) => {
        try {
            handler(event.channelId, event.id);
        } catch (err) {
            console.error("[P2PShare] handler de MESSAGE_DELETE falhou", err);
        }
    };

    FluxDispatcher().subscribe("MESSAGE_DELETE", listener);
    return () => FluxDispatcher().unsubscribe("MESSAGE_DELETE", listener);
}
