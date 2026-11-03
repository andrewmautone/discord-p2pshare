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
import { createHash } from "node:crypto";
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

// O componente de áudio vai sempre dentro do instalador, e tem que ser o
// exato binário que o plugin aceita: o plugin confere o SHA-256 antes de
// executar e, se não bater, baixa outro na primeira transmissão. Aqui o hash
// vem do próprio P2PShare.plugin.js que vai junto, então os dois não divergem.
const pluginFile = resolve(outDir, "P2PShare.plugin.js");
if (!existsSync(pluginFile)) throw new Error("falta release/P2PShare.plugin.js");
const pluginSrc = await readFile(pluginFile, "utf8");
const helperSha = pluginSrc.match(/HELPER_SHA256 = "([0-9a-f]{64})"/)?.[1];
const helperTag = pluginSrc.match(/HELPER_TAG = "([^"]+)"/)?.[1];
if (!helperSha || !helperTag) throw new Error("não achei HELPER_SHA256/HELPER_TAG no plugin");

const helperFile = resolve(outDir, "p2pshare-audio.exe");
const sha256 = buf => createHash("sha256").update(buf).digest("hex");

let helperOk = existsSync(helperFile) && sha256(await readFile(helperFile)) === helperSha;
if (!helperOk) {
    const url = `https://github.com/andrewmautone/discord-p2pshare/releases/download/${helperTag}/p2pshare-audio.exe`;
    console.log(`componente de áudio ausente ou diferente do que o plugin espera; baixando ${helperTag}...`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`download do componente de áudio falhou: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== helperSha) throw new Error("componente de áudio baixado não confere com HELPER_SHA256 do plugin");
    await writeFile(helperFile, buf);
    helperOk = true;
}
console.log(`componente de áudio: ${helperSha.slice(0, 16)}… (confere com o plugin)`);

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
