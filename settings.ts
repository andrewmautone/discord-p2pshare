/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { DEFAULT_BUDGET_MBPS } from "./constants";

/**
 * Módulo separado do index para quebrar o ciclo: broadcast importa o host, que
 * importa as settings. Se elas morassem no index, o ciclo fecharia.
 */
export const settings = definePluginSettings({
    uploadBudgetMbps: {
        type: OptionType.SLIDER,
        description: "Orçamento de upload em Mbps, dividido entre os viewers conectados",
        markers: [5, 10, 15, 25, 50, 100],
        default: DEFAULT_BUDGET_MBPS,
        stickToMarkers: false
    },
    captureAudio: {
        type: OptionType.BOOLEAN,
        description: "Transmitir o áudio do sistema (inclui o áudio do próprio Discord)",
        default: true
    },
    audioDeviceId: {
        type: OptionType.STRING,
        description: "Id do dispositivo de áudio a capturar (vazio = áudio do sistema)",
        default: ""
    },
    overlayX: { type: OptionType.NUMBER, description: "", default: 80, hidden: true },
    overlayY: { type: OptionType.NUMBER, description: "", default: 80, hidden: true },
    overlayWidth: { type: OptionType.NUMBER, description: "", default: 640, hidden: true }
});
