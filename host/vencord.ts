/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast, Toasts } from "@webpack/common";

import {
    deleteMessage,
    fetchAttachmentText,
    fetchRecentMessages,
    getCurrentUserId,
    getCurrentUsername,
    getUsername,
    getVoiceChannelId,
    openDm,
    sendMessage,
    uploadTextAttachment
} from "../discord/api";
import { onMessageCreate, onMessageDelete, onVoiceChannelChange } from "../discord/events";
import * as relays from "../discord/relays";
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
    fetchRecentMessages,
    openDm,

    onMessageCreate,
    onMessageDelete,
    onVoiceChannelChange,

    openRelaySocket: relays.openRelaySocket,
    getSelectedGuildId: relays.getSelectedGuildId,
    getChannelGuildId: relays.getChannelGuildId,
    getGuildVoiceChannelIds: relays.getGuildVoiceChannelIds,
    isUserInVoiceChannel: relays.isUserInVoiceChannel,
    onNavigationChange: relays.onNavigationChange,

    toast: (message, kind) => showToast(message, TOAST_TYPE[kind]),
    getBudgetMbps: () => settings.store.uploadBudgetMbps,
    shouldCaptureAudio: () => settings.store.captureAudio,
    getAudioDeviceId: () => settings.store.audioDeviceId || null,
    // O auxiliar nativo hoje só é distribuído com a versão BetterDiscord.
    captureIsolatedAudio: () => Promise.resolve(null),
    pickSource: openSourcePicker,

    mountOverlay,
    unmountOverlay,
    unmountAllOverlays,
    setOverlayViewers,

    // O painel de voz do Vencord ainda não tem selo: o alvo hoje é o
    // BetterDiscord, e um no-op mantém a interface honesta.
    // Sem selo na lista no Vencord por enquanto: a interface de selos é do BD.
    setLiveUsers: () => { }
};
