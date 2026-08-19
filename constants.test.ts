/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HELPER_URL, ICE_SERVERS, PLUGIN_VERSION } from "./constants";

describe("HELPER_URL", () => {
    // A URL apontava para releases/download/v${PLUGIN_VERSION}/. Como o plugin
    // chega na máquina antes de a release ser publicada, o download batia numa
    // tag inexistente e voltava 404 — e o componente nunca instalava.
    it("não depende da versão do plugin", () => {
        assert.doesNotMatch(HELPER_URL, new RegExp(`v${PLUGIN_VERSION.replace(/\./g, "\\.")}`));
    });

    it("aponta para um asset de release do repositório", () => {
        assert.match(HELPER_URL, /^https:\/\/github\.com\/[\w-]+\/[\w-]+\/releases\/download\//);
        assert.match(HELPER_URL, /\/p2pshare-audio\.exe$/);
    });
});

describe("ICE_SERVERS", () => {
    // Um provedor só significa que uma rede que o bloqueie derruba o
    // gathering inteiro: sem candidato srflx o SDP sai inútil.
    it("usa operadores independentes", () => {
        const hosts = ICE_SERVERS.map(s => String(s.urls).replace(/^stun:/, "").split(":")[0]);
        const domains = new Set(hosts.map(h => h.split(".").slice(-2).join(".")));

        assert.ok(domains.size >= 3, `esperava 3+ operadores, veio ${[...domains].join(", ")}`);
    });
});
