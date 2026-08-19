/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton,type ChatBarButtonFactory } from "@api/ChatButtons";
import { ScreenshareIcon } from "@components/Icons";
import { useEffect, useState } from "@webpack/common";

import {
    type BroadcastState,
    getBroadcastState,
    onBroadcastStateChange,
    startBroadcast,
    stopBroadcast
} from "../broadcast";

function tooltipFor(state: BroadcastState): string {
    if (!state.active) return "Transmitir tela via P2P";

    return state.viewers === 1
        ? "Parar transmissão P2P — 1 assistindo"
        : `Parar transmissão P2P — ${state.viewers} assistindo`;
}

/**
 * Botão na barra do chat. Usa a API oficial de chat buttons do Vencord em vez
 * de um patch no painel de voz: não depende de regex contra o bundle do
 * Discord, então não quebra quando eles atualizam.
 */
export const P2PShareChatButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const [state, setState] = useState<BroadcastState>(getBroadcastState);

    useEffect(() => onBroadcastStateChange(setState), []);

    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip={tooltipFor(state)}
            onClick={() => {
                if (state.active) void stopBroadcast();
                else void startBroadcast();
            }}
        >
            <ScreenshareIcon
                width={20}
                height={20}
                style={{ color: state.active ? "var(--status-danger)" : undefined }}
            />
        </ChatBarButton>
    );
};

export { ScreenshareIcon as P2PShareIcon };
