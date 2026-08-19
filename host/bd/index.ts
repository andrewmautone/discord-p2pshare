/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DEFAULT_BUDGET_MBPS } from "../../constants";
import type { Host, ToastKind } from "../types";
import * as api from "./api";
import * as ui from "./ui";

declare const BdApi: any;

const STORE = "P2PShare";

export function loadSetting<T>(key: string, fallback: T): T {
    const value = BdApi.Data.load(STORE, key);
    return value === undefined || value === null ? fallback : (value as T);
}

export function saveSetting(key: string, value: unknown): void {
    BdApi.Data.save(STORE, key, value);
}

const TOAST_TYPE: Record<ToastKind, string> = {
    info: "info",
    success: "success",
    error: "error"
};

export const host: Host = {
    getCurrentUserId: api.getCurrentUserId,
    getCurrentUsername: api.getCurrentUsername,
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

    announceBeacon: ui.announceBeacon,
    revokeBeacon: ui.revokeBeacon
};

export { ui };
export type { BeaconNotice, Host, HostMessage, ToastKind } from "../types";
