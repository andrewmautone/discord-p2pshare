/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    beaconsFromPresence,
    broadcastActivity,
    isPresenceKey,
    parseActivity,
    presenceKey
} from "./presence";

const CHAN = "1141498155561664692";

describe("broadcastActivity / parseActivity", () => {
    it("ida e volta preserva sessão e canal", () => {
        const a = broadcastActivity("abc12345", CHAN, 1000);
        assert.deepEqual(parseActivity(a), { sessionId: "abc12345", channelId: CHAN });
    });

    it("mostra algo legível para quem não tem o plugin", () => {
        const a = broadcastActivity("abc12345", CHAN, 1000);
        assert.equal(a.name, "P2PShare");
        assert.ok("application_id" in a);
        assert.match(a.details, /Transmitindo/);
    });

    it("ignora atividade de outro jogo", () => {
        assert.equal(parseActivity({ name: "Minecraft", party: { id: "p2ps:1:1:x" } }), null);
    });

    it("ignora versão de protocolo diferente", () => {
        assert.equal(parseActivity({ name: "P2PShare", party: { id: `p2ps:999:${CHAN}:x` } }), null);
    });

    it("ignora lixo sem quebrar", () => {
        for (const raw of [null, undefined, 1, "x", {}, { name: "P2PShare" }, { name: "P2PShare", party: { id: 5 } }]) {
            assert.equal(parseActivity(raw), null);
        }
    });
});

describe("beaconsFromPresence", () => {
    const live = (userId: string, channelId = CHAN) => ({
        userId,
        username: `u${userId}`,
        activities: [{ name: "Spotify" }, broadcastActivity(`s${userId}`, channelId, 1)]
    });

    it("acha quem transmite no canal", () => {
        const found = beaconsFromPresence(CHAN, [live("1"), { userId: "2", username: "u2", activities: [] }]);
        assert.equal(found.length, 1);
        assert.equal(found[0].broadcasterId, "1");
        assert.equal(found[0].sessionId, "s1");
        assert.equal(found[0].messageId, presenceKey("s1"));
        assert.ok(isPresenceKey(found[0].messageId));
    });

    it("descarta status que aponta para outra sala", () => {
        assert.deepEqual(beaconsFromPresence(CHAN, [live("1", "999")]), []);
    });

    it("descarta o próprio usuário", () => {
        assert.deepEqual(beaconsFromPresence(CHAN, [live("1")], "1"), []);
    });
});
