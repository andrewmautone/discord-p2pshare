/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast, Toasts } from "@webpack/common";

import {
    deleteMessage,
    fetchAttachmentText,
    getCurrentUserId,
    getCurrentUsername,
    getVoiceChannelId,
    sendMessage,
    uploadTextAttachment
} from "../discord/api";
import { onMessageCreate, onMessageDelete } from "../discord/events";
import { settings } from "../settings";
import { openSourcePicker } from "../ui/SourcePicker";
import { mountOverlay, unmountAllOverlays, unmountOverlay } from "../ui/ViewerOverlay";
import type { Host, ToastKind } from "./types";

const TOAST_TYPE: Record<ToastKind, string> = {
    info: Toasts.Type.MESSAGE,
    success: Toasts.Type.SUCCESS,
    error: Toasts.Type.FAILURE
};

export const host: Host = {
    getCurrentUserId,
    getCurrentUsername,
    getVoiceChannelId,

    sendMessage,
    deleteMessage,
    uploadTextAttachment,
    fetchAttachmentText,

    onMessageCreate,
    onMessageDelete,

    toast: (message, kind) => showToast(message, TOAST_TYPE[kind]),
    getBudgetMbps: () => settings.store.uploadBudgetMbps,
    pickSource: openSourcePicker,

    mountOverlay,
    unmountOverlay,
    unmountAllOverlays,

    // O botão "Assistir" é renderizado direto na mensagem pelo accessory.
    announceBeacon: () => { },
    revokeBeacon: () => { }
};
