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
    getUsername,
    getVoiceChannelId,
    openDm,
    sendMessage,
    uploadTextAttachment
} from "../discord/api";
import { onMessageCreate, onMessageDelete } from "../discord/events";
import { settings } from "../settings";
import { openSourcePicker } from "../ui/SourcePicker";
import { mountOverlay, setOverlayViewers, unmountAllOverlays, unmountOverlay } from "../ui/ViewerOverlay";
import type { Host, ToastKind } from "./types";

const TOAST_TYPE: Record<ToastKind, string> = {
    info: Toasts.Type.MESSAGE,
    success: Toasts.Type.SUCCESS,
    error: Toasts.Type.FAILURE
};

export const host: Host = {
    getCurrentUserId,
    getCurrentUsername,
    getUsername,
    getVoiceChannelId,

    sendMessage,
    deleteMessage,
    uploadTextAttachment,
    fetchAttachmentText,
    openDm,

    onMessageCreate,
    onMessageDelete,

    toast: (message, kind) => showToast(message, TOAST_TYPE[kind]),
    getBudgetMbps: () => settings.store.uploadBudgetMbps,
    pickSource: openSourcePicker,

    mountOverlay,
    unmountOverlay,
    unmountAllOverlays,
    setOverlayViewers,

    // O painel de voz do Vencord ainda não tem selo: o alvo hoje é o
    // BetterDiscord, e um no-op mantém a interface honesta.
    setLiveUsers: () => { },

    // O botão "Assistir" é renderizado direto na mensagem pelo accessory.
    announceBeacon: () => { },
    revokeBeacon: () => { }
};
