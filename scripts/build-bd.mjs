/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { defaultKeyPaths, loadSigningKeys, signSource } from "./signing.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "release");
const outFile = resolve(outDir, "P2PShare.plugin.js");

// Antes de tudo: sem o par de chaves não existe release. Um plugin sem chave
// embutida recusaria toda atualização e ficaria preso nesta versão.
const { publicKeyPath, privateKeyPath } = defaultKeyPaths(root);
const { publicKey, privateKeyPem } = await loadSigningKeys(publicKeyPath, privateKeyPath);

// Fonte única da versão: constants.ts. Duas cópias divergiriam, e o updater
// compara justamente esse número.
const constantsSrc = await readFile(resolve(root, "constants.ts"), "utf8");
const versionMatch = constantsSrc.match(/PLUGIN_VERSION\s*=\s*"([^"]+)"/);
if (!versionMatch) throw new Error("não achei PLUGIN_VERSION em constants.ts");
const pkgVersion = versionMatch[1];

const META = `/**
 * @name P2PShare
 * @author Andrew
 * @description Compartilhamento de tela ponto-a-ponto via WebRTC, sem passar pela infra de video do Discord e sem servidor proprio.
 * @version ${pkgVersion}
 * @source https://github.com/andrewmautone/discord-p2pshare
 */
`;

/** Aponta qualquer import de host para a implementação do BetterDiscord. */
const swapHost = {
    name: "swap-host",
    setup(build) {
        build.onResolve({ filter: /(^|\/)host$/ }, args => {
            if (args.kind === "entry-point") return null;
            return { path: resolve(root, "host/bd/index.ts") };
        });
    }
};

await mkdir(outDir, { recursive: true });

await build({
    entryPoints: [resolve(root, "bd-entry.ts")],
    outfile: outFile,
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "chrome128",
    minify: false,
    legalComments: "none",
    logLevel: "info",
    plugins: [swapHost],
    // O plugin roda no renderer do Electron, onde os módulos do Node existem
    // em tempo de execução. Empacotá-los é impossível e desnecessário.
    external: ["fs", "path", "crypto", "child_process", "os", "electron"],
    // esbuild exporta { default: P2PShare }; o BetterDiscord espera a classe
    // direto em module.exports.
    footer: { js: "module.exports = module.exports.default;" }
});

// O plugin confere o auxiliar nativo por SHA-256 antes de executá-lo e, se não
// tiver um que bata, baixa o publicado em HELPER_TAG. Então o hash embutido
// tem que ser o DESSE binário publicado: um hash vazio ou de uma compilação
// local que ninguém publicou faz o plugin recusar todo auxiliar e o áudio
// nunca funcionar (aconteceu num build fora do Vencord, sem o Rust compilado).
//
// Padrão: o binário publicado em HELPER_TAG (baixado e guardado em release/).
// P2PSHARE_HELPER_LOCAL=1 usa a compilação local — só junto de uma tag nova
// em HELPER_TAG com esse mesmo binário publicado.
const helperTag = constantsSrc.match(/HELPER_TAG\s*=\s*"([^"]+)"/)?.[1];
if (!helperTag) throw new Error("não achei HELPER_TAG em constants.ts");
const helperOut = resolve(outDir, "p2pshare-audio.exe");
const sha = buf => createHash("sha256").update(buf).digest("hex");
let helperHash;

if (process.env.P2PSHARE_HELPER_LOCAL === "1") {
    const helperExe = resolve(root, "native/audio-helper/target/release/p2pshare-audio.exe");
    const buf = await readFile(helperExe);
    helperHash = sha(buf);
    await copyFile(helperExe, helperOut);
    console.log(`auxiliar de áudio LOCAL: ${helperHash.slice(0, 16)}… — publique em ${helperTag}`);
} else {
    const url = `https://github.com/andrewmautone/discord-p2pshare/releases/download/${helperTag}/p2pshare-audio.exe`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`não deu para baixar o auxiliar publicado (${helperTag}): ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    helperHash = sha(buf);
    await writeFile(helperOut, buf);
    console.log(`auxiliar de áudio publicado (${helperTag}): ${helperHash.slice(0, 16)}…`);
}

// Prefixa o cabeçalho que o BetterDiscord lê para nome, autor e versão.
let bundled = await readFile(outFile, "utf8");
bundled = bundled.replace("__HELPER_SHA256__", helperHash);
bundled = bundled.replace("__UPDATE_PUBLIC_KEY__", publicKey);
const pluginSource = META + bundled;
await writeFile(outFile, pluginSource, "utf8");

// Assina o texto final, cabeçalho incluído: é o que o updater baixa e confere.
// Vai para o git no mesmo commit do plugin.
await writeFile(`${outFile}.sig`, `${signSource(pluginSource, privateKeyPem)}\n`, "utf8");

// Só o número da versão: é o que a atualização automática checa a cada
// poucos minutos (VERSION_URL), em vez de baixar o plugin inteiro. Vai para o
// git no mesmo commit do plugin.
await writeFile(resolve(outDir, "VERSION"), `${pkgVersion}\n`, "utf8");

// Só o plugin e as instruções. Nada de script: o BetterDiscord já instala
// plugin arrastando o arquivo, e um .bat/.ps1 no zip só serve para disparar
// aviso de SmartScreen e assustar quem vai instalar.
for (const name of ["LEIA-ME.txt"]) {
    const from = resolve(root, "scripts", name);
    try {
        await copyFile(from, resolve(outDir, name));
    } catch (err) {
        if (err.code !== "ENOENT") throw err;
        console.warn(`aviso: ${name} não encontrado, seguindo sem ele`);
    }
}

// Carregador próprio e instalador do Windows: mesmo passo que roda sozinho em
// `node scripts/build-standalone.mjs`, sem recompilar o plugin.
await import("./build-standalone.mjs");
