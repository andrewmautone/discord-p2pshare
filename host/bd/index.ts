/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DEFAULT_BUDGET_MBPS } from "../../constants";
import type { Host, ToastKind } from "../types";
import * as api from "./api";
import { captureIsolatedAudio } from "./audioHelper";
import { loadSetting } from "./settings";
import * as ui from "./ui";

declare const BdApi: any;


const TOAST_TYPE: Record<ToastKind, string> = {
    info: "info",
    success: "success",
    error: "error"
};

export const host: Host = {
    getCurrentUserId: api.getCurrentUserId,
    getCurrentUsername: api.getCurrentUsername,
    getUsername: api.getUsername,
    getVoiceChannelId: api.getVoiceChannelId,

    sendMessage: api.sendMessage,
    deleteMessage: api.deleteMessage,
    uploadTextAttachment: api.uploadTextAttachment,
    fetchAttachmentText: api.fetchAttachmentText,
    openDm: api.openDm,

    onMessageCreate: api.onMessageCreate,
    onMessageDelete: api.onMessageDelete,
    onVoiceChannelChange: api.onVoiceChannelChange,

    toast: (message, kind) => BdApi.UI.showToast(message, { type: TOAST_TYPE[kind] }),
    getBudgetMbps: () => loadSetting("uploadBudgetMbps", DEFAULT_BUDGET_MBPS),
    shouldCaptureAudio: () => loadSetting("captureAudio", true),
    getAudioDeviceId: () => loadSetting<string | null>("audioDeviceId", null),
    captureIsolatedAudio: () => {
        const mode = loadSetting("audioMode", "isolated");

        if (mode === "isolated") return captureIsolatedAudio({ mode: "discord" });
        if (mode === "app") {
            return captureIsolatedAudio({
                mode: "app",
                appName: loadSetting<string | null>("audioApp", null)
            });
        }

        // "system": o loopback comum do Chromium dá conta.
        return Promise.resolve(null);
    },
    pickSource: ui.openSourcePicker,

    mountOverlay: ui.mountOverlay,
    unmountOverlay: ui.unmountOverlay,
    unmountAllOverlays: ui.unmountAllOverlays,
    setOverlayViewers: ui.setOverlayViewers,

    setLiveUsers: ui.setLiveUsers,

    announceBeacon: ui.announceBeacon,
    revokeBeacon: ui.revokeBeacon
};

export { ui };
export type { BeaconNotice, Host, HostMessage, ToastKind } from "../types";
export { loadSetting, saveSetting } from "./settings";
