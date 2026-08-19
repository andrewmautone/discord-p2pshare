/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@webpack/common";

import { type BeaconSource, parseBeacon } from "../beacon";
import { host } from "../host";
import { startWatching } from "../watch";

/**
 * Botão "Assistir" no lugar do beacon. Devolve null quando a mensagem não é um
 * beacon — o accessory roda em toda mensagem do chat.
 */
export function BeaconAccessory({ message }: { message: BeaconSource; }) {
    const beacon = parseBeacon(message);
    if (!beacon) return null;
    if (beacon.broadcasterId === host.getCurrentUserId()) return null;

    return (
        <Button
            size={Button.Sizes.SMALL}
            color={Button.Colors.BRAND}
            onClick={() => { void startWatching(beacon); }}
        >
            Assistir transmissão P2P
        </Button>
    );
}
