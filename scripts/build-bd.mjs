/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "release");
const outFile = resolve(outDir, "P2PShare.plugin.js");

const pkgVersion = "1.0.0";

const META = `/**
 * @name P2PShare
 * @author Andrew
 * @description Compartilhamento de tela ponto-a-ponto via WebRTC, sem passar pela infra de video do Discord e sem servidor proprio.
 * @version ${pkgVersion}
 * @source https://github.com/andrewmautone/vencord-p2pshare
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
    // esbuild exporta { default: P2PShare }; o BetterDiscord espera a classe
    // direto em module.exports.
    footer: { js: "module.exports = module.exports.default;" }
});

// Prefixa o cabeçalho que o BetterDiscord lê para nome, autor e versão.
const bundled = await readFile(outFile, "utf8");
await writeFile(outFile, META + bundled, "utf8");

// O instalador viaja junto do plugin: o .ps1 procura o .plugin.js ao lado dele.
for (const name of ["instalar.ps1", "Instalar.bat", "LEIA-ME.txt"]) {
    const from = resolve(root, "scripts", name);
    try {
        await copyFile(from, resolve(outDir, name));
    } catch (err) {
        if (err.code !== "ENOENT") throw err;
        console.warn(`aviso: ${name} não encontrado, seguindo sem ele`);
    }
}

console.log(`\nPronto: ${outDir}`);
console.log("Zipe a pasta release/ inteira e mande para quem vai instalar.");
