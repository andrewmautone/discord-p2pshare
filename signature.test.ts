/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { createSigningKeys, loadSigningKeys, saveSigningKeys, signSource } from "./scripts/signing.mjs";
import { verifyPluginSignature, vetUpdate } from "./updater";

const keys = createSigningKeys();
const otherKeys = createSigningKeys();

function pluginSource(version: string): string {
    return `/**\n * @name P2PShare\n * @version ${version}\n */\nmodule.exports = 1;\n${"// corpo\n".repeat(200)}`;
}

describe("verifyPluginSignature", () => {
    const source = pluginSource("2.0.0");

    it("aceita o plugin assinado pela chave certa", async () => {
        const signature = signSource(source, keys.privateKeyPem);
        assert.equal(await verifyPluginSignature(source, signature, keys.publicKey), true);
    });

    it("aceita o arquivo .sig com quebra de linha no fim", async () => {
        const signature = `${signSource(source, keys.privateKeyPem)}\n`;
        assert.equal(await verifyPluginSignature(source, signature, keys.publicKey), true);
    });

    it("recusa o plugin com um caractere trocado", async () => {
        const signature = signSource(source, keys.privateKeyPem);
        const tampered = source.replace("module.exports = 1", "module.exports = 2");
        assert.equal(await verifyPluginSignature(tampered, signature, keys.publicKey), false);
    });

    it("recusa assinatura feita com outra chave", async () => {
        const signature = signSource(source, otherKeys.privateKeyPem);
        assert.equal(await verifyPluginSignature(source, signature, keys.publicKey), false);
    });

    it("recusa assinatura vazia ou ilegível sem lançar erro", async () => {
        assert.equal(await verifyPluginSignature(source, "", keys.publicKey), false);
        assert.equal(await verifyPluginSignature(source, "<html>404</html>", keys.publicKey), false);
    });

    it("recusa tudo enquanto a chave pública não foi embutida", async () => {
        const signature = signSource(source, keys.privateKeyPem);
        assert.equal(await verifyPluginSignature(source, signature, "__UPDATE_PUBLIC_KEY__"), false);
    });
});

describe("vetUpdate", () => {
    const vet = (source: string, signature: string | null) => vetUpdate({
        source,
        signature,
        publicKey: keys.publicKey,
        pluginName: "P2PShare",
        currentVersion: "1.21.4"
    });

    it("devolve a versão de um plugin mais novo e assinado", async () => {
        const source = pluginSource("1.22.0");
        assert.equal(await vet(source, signSource(source, keys.privateKeyPem)), "1.22.0");
    });

    it("recusa plugin sem arquivo de assinatura", async () => {
        assert.equal(await vet(pluginSource("1.22.0"), null), null);
    });

    it("recusa plugin com assinatura inválida", async () => {
        const source = pluginSource("1.22.0");
        assert.equal(await vet(source, signSource(source, otherKeys.privateKeyPem)), null);
    });

    it("recusa versão antiga mesmo com assinatura válida", async () => {
        const source = pluginSource("1.20.0");
        assert.equal(await vet(source, signSource(source, keys.privateKeyPem)), null);
    });

    it("recusa o que não parece o plugin mesmo com assinatura válida", async () => {
        const source = "<html>erro</html>";
        assert.equal(await vet(source, signSource(source, keys.privateKeyPem)), null);
    });
});

describe("chaves de assinatura em disco", () => {
    let dir = "";

    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = "";
    });

    function paths() {
        dir = mkdtempSync(join(tmpdir(), "p2ps-keys-"));
        return { publicKeyPath: join(dir, "update-signing.pub"), privateKeyPath: join(dir, "private", "key.pem") };
    }

    it("grava o par e carrega de volta uma chave que assina", async () => {
        const { publicKeyPath, privateKeyPath } = paths();
        await saveSigningKeys(publicKeyPath, privateKeyPath);

        const loaded = await loadSigningKeys(publicKeyPath, privateKeyPath);
        const source = pluginSource("2.0.0");
        const signature = signSource(source, loaded.privateKeyPem);

        assert.equal(await verifyPluginSignature(source, signature, loaded.publicKey), true);
    });

    it("não sobrescreve uma chave privada que já existe", async () => {
        const { publicKeyPath, privateKeyPath } = paths();
        await saveSigningKeys(publicKeyPath, privateKeyPath);
        const before = readFileSync(privateKeyPath, "utf8");

        await assert.rejects(saveSigningKeys(publicKeyPath, privateKeyPath), /já existe/);
        assert.equal(readFileSync(privateKeyPath, "utf8"), before);
    });

    it("falha sem a chave pública no repo", async () => {
        const { publicKeyPath, privateKeyPath } = paths();
        await saveSigningKeys(publicKeyPath, privateKeyPath);
        rmSync(publicKeyPath);
        assert.equal(existsSync(publicKeyPath), false);

        await assert.rejects(loadSigningKeys(publicKeyPath, privateKeyPath), /chave pública/);
    });

    it("falha sem a chave privada", async () => {
        const { publicKeyPath, privateKeyPath } = paths();
        await saveSigningKeys(publicKeyPath, privateKeyPath);
        rmSync(privateKeyPath);

        await assert.rejects(loadSigningKeys(publicKeyPath, privateKeyPath), /chave privada/);
    });

    it("falha quando a chave privada não é o par da pública", async () => {
        const { publicKeyPath, privateKeyPath } = paths();
        await saveSigningKeys(publicKeyPath, privateKeyPath);
        writeFileSync(publicKeyPath, `${otherKeys.publicKey}\n`);

        await assert.rejects(loadSigningKeys(publicKeyPath, privateKeyPath), /não formam um par/);
    });
});
