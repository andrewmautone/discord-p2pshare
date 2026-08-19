/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deliverHandshake } from "./handshake";

interface Sent {
    channelId: string;
    filename: string;
}

function fakeSender(opts: {
    dm?: string | null;
    dmThrows?: boolean;
    failOn?: string;
}) {
    const sent: Sent[] = [];

    return {
        sent,
        sender: {
            openDm: async () => {
                if (opts.dmThrows) throw new Error("DMs fechadas");
                return opts.dm === undefined ? "dm-1" : opts.dm;
            },
            upload: async (channelId: string, filename: string) => {
                if (opts.failOn === channelId) throw new Error("upload recusado");
                sent.push({ channelId, filename });
            }
        }
    };
}

const payload = {
    fallbackChannelId: "canal-1",
    targetUserId: "viewer-1",
    filename: "p2p.abc.offer.viewer-1.txt",
    body: "{}",
    marker: ""
};

describe("deliverHandshake", () => {
    it("entrega pela DM quando dá", async () => {
        const { sent, sender } = fakeSender({});

        const via = await deliverHandshake(sender, payload);

        assert.equal(via, "dm");
        assert.deepEqual(sent.map(s => s.channelId), ["dm-1"]);
    });

    it("cai para o canal quando não há DM disponível", async () => {
        const { sent, sender } = fakeSender({ dm: null });

        const via = await deliverHandshake(sender, payload);

        assert.equal(via, "channel");
        assert.deepEqual(sent.map(s => s.channelId), ["canal-1"]);
    });

    it("cai para o canal quando abrir a DM falha", async () => {
        const { sent, sender } = fakeSender({ dmThrows: true });

        const via = await deliverHandshake(sender, payload);

        assert.equal(via, "channel");
        assert.deepEqual(sent.map(s => s.channelId), ["canal-1"]);
    });

    it("cai para o canal quando a DM abre mas o envio falha", async () => {
        const { sent, sender } = fakeSender({ failOn: "dm-1" });

        const via = await deliverHandshake(sender, payload);

        assert.equal(via, "channel");
        assert.deepEqual(sent.map(s => s.channelId), ["canal-1"]);
    });

    it("propaga o erro quando nem o canal aceita", async () => {
        const { sender } = fakeSender({ dm: null, failOn: "canal-1" });

        await assert.rejects(() => deliverHandshake(sender, payload), /upload recusado/);
    });

    it("não tenta a DM quando ela é o próprio destino do fallback", async () => {
        // Conversa que já acontece numa DM: abrir DM de novo seria redundante.
        const { sent, sender } = fakeSender({ dm: "canal-1" });

        const via = await deliverHandshake(sender, { ...payload, fallbackChannelId: "canal-1" });

        assert.equal(via, "dm");
        assert.deepEqual(sent.map(s => s.channelId), ["canal-1"]);
    });
});
