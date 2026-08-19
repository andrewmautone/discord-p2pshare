/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

// Compila o instalador do Windows, se o Inno Setup estiver na máquina.
// É opcional de propósito: o .plugin.js sozinho já instala arrastando, então
// quem só quer o plugin não precisa de toolchain nenhuma.
const ISCC_CANDIDATES = [
    `${process.env.LOCALAPPDATA}\\Programs\\Inno Setup 6\\ISCC.exe`,
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe"
];

const iscc = ISCC_CANDIDATES.find(p => p && existsSync(p));

if (!iscc) {
    console.log("\nInno Setup não encontrado — pulando o instalador .exe.");
    console.log("Para gerá-lo: winget install JRSoftware.InnoSetup");
} else {
    console.log("\nCompilando o instalador do Windows...");
    const res = spawnSync(iscc, [resolve(root, "scripts", "installer.iss")], {
        encoding: "utf8"
    });

    if (res.status !== 0) {
        console.error(res.stdout || "");
        console.error(res.stderr || "");
        throw new Error("falha ao compilar o instalador");
    }

    console.log("Instalador pronto: release/P2PShare-Setup.exe");
}

console.log(`\nPronto: ${outDir}`);
