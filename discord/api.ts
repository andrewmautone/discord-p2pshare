/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CloudUpload as TCloudUpload } from "@vencord/discord-types";
import { CloudUploadPlatform } from "@vencord/discord-types/enums";
import { findLazy } from "@webpack";
import { Constants, RestAPI, SelectedChannelStore, SnowflakeUtils, UserStore } from "@webpack/common";

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

export async function fetchAttachmentText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`anexo respondeu ${res.status}`);
    return res.text();
}
