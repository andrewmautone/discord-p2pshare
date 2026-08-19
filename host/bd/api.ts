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
 */
function lazy<T>(find: () => T): () => T {
    let cached: T | undefined;
    return () => {
        if (cached === undefined) {
            cached = find();
            if (cached === undefined) {
                throw new Error("[P2PShare] módulo do Discord não encontrado");
            }
        }
        return cached;
    };
}

const { getModule } = BdApi.Webpack;

const UserStore = lazy(() => getModule((m: any) => m?.getCurrentUser && m?.getUser));
const SelectedChannelStore = lazy(() => getModule((m: any) => m?.getVoiceChannelId && m?.getChannelId));
const FluxDispatcher = lazy(() => getModule((m: any) => m?.dispatch && m?.subscribe && m?.unsubscribe));
const RestAPI = lazy(() => getModule((m: any) => typeof m === "object" && m?.del && m?.put && m?.post));
const CloudUpload = lazy(() => getModule((m: any) => m?.prototype?.trackUploadFinished));

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
