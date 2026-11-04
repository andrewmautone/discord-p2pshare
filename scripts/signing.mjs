/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Assinatura das atualizações automáticas.
 *
 * O plugin se substitui sozinho com o que estiver no `main` do GitHub. Sem
 * assinatura, quem conseguisse escrever no repo mandaria código para todo
 * mundo em até 10 minutos. A chave privada fica fora do repo, só na máquina
 * que faz o build, e o plugin confere com a pública embutida nele.
 *
 * ECDSA P-256 porque o `crypto.subtle` do renderer verifica sem dependência
 * nova em qualquer versão do Discord.
 *
 * Gerar o par, uma vez só: `node scripts/signing.mjs keygen`
 */

import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KEYGEN_HINT = 'rode "node scripts/signing.mjs keygen" na máquina que faz o build';

function exportPublicKey(key) {
    return key.export({ type: "spki", format: "der" }).toString("base64");
}

export function createSigningKeys() {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    return {
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
        publicKey: exportPublicKey(publicKey)
    };
}

/** Assinatura em base64 no formato IEEE P1363, o que o `crypto.subtle` lê. */
export function signSource(source, privateKeyPem) {
    return sign("sha256", Buffer.from(source, "utf8"), {
        key: privateKeyPem,
        dsaEncoding: "ieee-p1363"
    }).toString("base64");
}

/** A privada fora do repo; a variável existe para outra máquina ou um cofre. */
export function defaultKeyPaths(root) {
    return {
        publicKeyPath: resolve(root, "scripts", "update-signing.pub"),
        privateKeyPath: process.env.P2PSHARE_SIGNING_KEY
            || join(homedir(), ".p2pshare", "update-signing-key.pem")
    };
}

/**
 * Nunca sobrescreve a privada: perder a chave em uso deixa quem já instalou
 * preso na versão atual, recusando toda atualização.
 */
export async function saveSigningKeys(publicKeyPath, privateKeyPath) {
    if (existsSync(privateKeyPath)) {
        throw new Error(`a chave privada já existe em ${privateKeyPath}; não vou sobrescrever`);
    }

    const { privateKeyPem, publicKey } = createSigningKeys();

    await mkdir(dirname(privateKeyPath), { recursive: true });
    await writeFile(privateKeyPath, privateKeyPem, { flag: "wx", mode: 0o600 });
    await writeFile(publicKeyPath, `${publicKey}\n`, "utf8");

    return { publicKey };
}

/**
 * Carrega o par e confere que um é do outro.
 *
 * Publicar assinado com a chave errada travaria as atualizações de todos, por
 * isso o build para aqui em vez de seguir.
 */
export async function loadSigningKeys(publicKeyPath, privateKeyPath) {
    if (!existsSync(publicKeyPath)) {
        throw new Error(`chave pública não encontrada em ${publicKeyPath}: ${KEYGEN_HINT}`);
    }
    if (!existsSync(privateKeyPath)) {
        throw new Error(`chave privada não encontrada em ${privateKeyPath}: ${KEYGEN_HINT}`);
    }

    const publicKey = (await readFile(publicKeyPath, "utf8")).trim();
    const privateKeyPem = await readFile(privateKeyPath, "utf8");

    if (exportPublicKey(createPublicKey(privateKeyPem)) !== publicKey) {
        throw new Error(`${publicKeyPath} e ${privateKeyPath} não formam um par`);
    }

    return { publicKey, privateKeyPem };
}

async function runKeygen() {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const { publicKeyPath, privateKeyPath } = defaultKeyPaths(root);

    await saveSigningKeys(publicKeyPath, privateKeyPath);

    console.log(`chave pública: ${publicKeyPath} (vai para o git)`);
    console.log(`chave privada: ${privateKeyPath} (NUNCA vai para o git)`);
    console.log("Guarde uma cópia da privada em lugar seguro: sem ela não sai mais atualização.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv[2] === "keygen") {
        runKeygen().catch(err => {
            console.error(err.message);
            process.exitCode = 1;
        });
    } else {
        console.error("uso: node scripts/signing.mjs keygen");
        process.exitCode = 1;
    }
}
