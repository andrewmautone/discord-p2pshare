/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addChatBarButton, removeChatBarButton } from "@api/ChatButtons";
import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import definePlugin from "@utils/types";

import { isBroadcasting, startBroadcast, stopBroadcast } from "./broadcast";
import { settings } from "./settings";
import { P2PShareChatButton, P2PShareIcon } from "./ui/ChatBarToggle";
import { initWatcher } from "./watch";

export { settings };

let cleanupWatcher: (() => void) | null = null;

export default definePlugin({
    name: "P2PShare",
    description: "Compartilhamento de tela ponto-a-ponto, sem passar pela infra de vídeo do Discord",
    authors: [{ name: "Andrew", id: 0n }],
    settings,

    commands: [{
        name: "p2pshare",
        description: "Liga ou desliga a transmissão de tela P2P no canal de voz atual",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute: (_args, ctx) => {
            if (isBroadcasting()) {
                void stopBroadcast();
                sendBotMessage(ctx.channel.id, { content: "Encerrando a transmissão P2P." });
            } else {
                void startBroadcast();
                sendBotMessage(ctx.channel.id, { content: "Iniciando a transmissão P2P…" });
            }
        }
    }],

    start() {
        cleanupWatcher = initWatcher();
        addChatBarButton("p2pshare", P2PShareChatButton, P2PShareIcon);
    },

    stop() {
        removeChatBarButton("p2pshare");
        void stopBroadcast();
        cleanupWatcher?.();
        cleanupWatcher = null;
    }
});
