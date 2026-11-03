/*
 * Carregador próprio do P2PShare (sem BetterDiscord) + instalador do Windows.
 *
 * Usa o release/P2PShare.plugin.js que já está lá — o versionado, que é o
 * mesmo que o auto-update distribui — e o release/p2pshare-audio.exe.
 *
 *   node scripts/build-standalone.mjs
 *
 * Saída:
 *   release/standalone/core/{main,preload,runtime}.js  → %AppData%\P2PShare\core
 *   release/standalone/app.asar (o gancho)             → Discord\app-*\resources\app.asar
 *                                 (o original vira app.orig.asar, sem alteração)
 *   release/P2PShare-Setup.exe                         (se o Inno Setup existir)
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { packAsar } from "./asar.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "release");
const standaloneDir = resolve(outDir, "standalone");
const coreDir = resolve(standaloneDir, "core");

const constantsSrc = await readFile(resolve(root, "constants.ts"), "utf8");
const version = constantsSrc.match(/PLUGIN_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (!version) throw new Error("não achei PLUGIN_VERSION em constants.ts");

await mkdir(coreDir, { recursive: true });

const common = { bundle: true, minify: false, legalComments: "none", logLevel: "warning" };

// Processo principal do Discord e preload: Node + Electron.
const nodeSide = { ...common, format: "cjs", platform: "node", target: "node22", external: ["electron", "original-fs"] };
await build({ ...nodeSide, entryPoints: [resolve(root, "standalone/main.ts")], outfile: resolve(coreDir, "main.js") });
await build({ ...nodeSide, entryPoints: [resolve(root, "standalone/preload.ts")], outfile: resolve(coreDir, "preload.js") });

// Página do Discord: navegador, sem Node.
await build({
    ...common,
    entryPoints: [resolve(root, "standalone/runtime.ts")],
    outfile: resolve(coreDir, "runtime.js"),
    format: "iife",
    platform: "browser",
    target: "chrome128"
});

// O gancho: um app.asar mínimo que liga o P2PShare e chama o original.
await rm(resolve(standaloneDir, "stub"), { recursive: true, force: true });
await writeFile(resolve(standaloneDir, "app.asar"), packAsar({
    "index.js": await readFile(resolve(root, "standalone/stub/index.js"), "utf8"),
    "package.json": await readFile(resolve(root, "standalone/stub/package.json"), "utf8")
}));
await copyFile(resolve(root, "scripts/LEIA-ME.txt"), resolve(outDir, "LEIA-ME.txt"));
console.log("carregador próprio: release/standalone/");

for (const need of ["P2PShare.plugin.js", "p2pshare-audio.exe"]) {
    if (!existsSync(resolve(outDir, need))) {
        console.warn(`aviso: falta release/${need} — o instalador não compila sem ele`);
    }
}

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
    const res = spawnSync(iscc, [`/DAppVersion=${version}`, resolve(root, "scripts", "installer.iss")], { encoding: "utf8" });
    if (res.status !== 0) {
        console.error(res.stdout || "");
        console.error(res.stderr || "");
        throw new Error("falha ao compilar o instalador");
    }
    console.log("Instalador pronto: release/P2PShare-Setup.exe");
}

console.log(`\nPronto: ${outDir}`);
