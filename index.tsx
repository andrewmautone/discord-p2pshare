/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { DEFAULT_BUDGET_MBPS } from "./constants";

export const settings = definePluginSettings({
    uploadBudgetMbps: {
        type: OptionType.SLIDER,
        description: "Orçamento de upload em Mbps, dividido entre os viewers conectados",
        markers: [5, 10, 15, 25, 50, 100],
        default: DEFAULT_BUDGET_MBPS,
        stickToMarkers: false
    },
    overlayX: { type: OptionType.NUMBER, description: "", default: 80, hidden: true },
    overlayY: { type: OptionType.NUMBER, description: "", default: 80, hidden: true },
    overlayWidth: { type: OptionType.NUMBER, description: "", default: 640, hidden: true }
});

export default definePlugin({
    name: "P2PShare",
    description: "Compartilhamento de tela ponto-a-ponto, sem passar pela infra de vídeo do Discord",
    authors: [{ name: "Andrew", id: 0n }],
    settings
});
