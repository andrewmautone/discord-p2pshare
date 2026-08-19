/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DEFAULT_BUDGET_MBPS } from "../../constants";
import type { Host, ToastKind } from "../types";
import * as api from "./api";
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

    onMessageCreate: api.onMessageCreate,
    onMessageDelete: api.onMessageDelete,

    toast: (message, kind) => BdApi.UI.showToast(message, { type: TOAST_TYPE[kind] }),
    getBudgetMbps: () => loadSetting("uploadBudgetMbps", DEFAULT_BUDGET_MBPS),
    pickSource: ui.openSourcePicker,

    mountOverlay: ui.mountOverlay,
    unmountOverlay: ui.unmountOverlay,
    unmountAllOverlays: ui.unmountAllOverlays,
    setOverlayViewers: ui.setOverlayViewers,

    announceBeacon: ui.announceBeacon,
    revokeBeacon: ui.revokeBeacon
};

export { ui };
export type { BeaconNotice, Host, HostMessage, ToastKind } from "../types";
export { loadSetting, saveSetting } from "./settings";
