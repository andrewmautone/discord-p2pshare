import assert from "node:assert/strict";
import { test } from "node:test";

import { RELAYS } from "../constants";
import {
    allowedRelay,
    allowedUrl,
    choosePluginSource,
    insideRoot,
    isAppVersionDir,
    isDiscordHost,
    isMainDiscordPage,
    RELAY_URLS
} from "./guards";

const ROOT = "C:\\Users\\x\\AppData\\Roaming\\P2PShare";

test("insideRoot aceita arquivos da pasta", () => {
    assert.equal(insideRoot(ROOT, ROOT + "\\p2pshare-audio.exe"), ROOT + "\\p2pshare-audio.exe");
    assert.equal(insideRoot(ROOT, "P2PShare.config.json"), ROOT + "\\P2PShare.config.json");
    assert.equal(insideRoot(ROOT, ROOT), ROOT);
});

test("insideRoot recusa quem escapa da pasta", () => {
    assert.equal(insideRoot(ROOT, ROOT + "\\..\\evil.exe"), null);
    assert.equal(insideRoot(ROOT, "C:\\Windows\\System32\\x.dll"), null);
    assert.equal(insideRoot(ROOT, "D:\\P2PShare\\a"), null);
    assert.equal(insideRoot(ROOT, "\\\\server\\share\\a"), null);
    assert.equal(insideRoot(ROOT, ROOT + "Evil\\a"), null);
    assert.equal(insideRoot(ROOT, ""), null);
    assert.equal(insideRoot(ROOT, 42 as unknown as string), null);
});

test("allowedUrl so libera https do GitHub", () => {
    assert.ok(allowedUrl("https://github.com/andrewmautone/discord-p2pshare/releases/download/audio-v2/p2pshare-audio.exe"));
    assert.ok(allowedUrl("https://raw.githubusercontent.com/andrewmautone/discord-p2pshare/main/release/P2PShare.plugin.js"));
    assert.ok(allowedUrl("https://objects.githubusercontent.com/x"));
    assert.ok(!allowedUrl("http://github.com/x"));
    assert.ok(!allowedUrl("https://github.com.evil.com/x"));
    assert.ok(!allowedUrl("https://evil.com/github.com"));
    assert.ok(!allowedUrl("file:///C:/x"));
    assert.ok(!allowedUrl("nada"));
});

test("isAppVersionDir", () => {
    assert.ok(isAppVersionDir("app-1.0.9266"));
    assert.ok(!isAppVersionDir("app"));
    assert.ok(!isAppVersionDir("packages"));
    assert.ok(!isAppVersionDir("app-1.0.9266.bak"));
    // Pasta temporaria do atualizador do Discord enquanto instala: nao e' alvo.
    assert.ok(!isAppVersionDir(".app-1.0.9267.installing"));
});

test("isDiscordHost", () => {
    assert.ok(isDiscordHost("discord.com"));
    assert.ok(isDiscordHost("canary.discord.com"));
    assert.ok(!isDiscordHost("evil-discord.com"));
    assert.ok(!isDiscordHost("discord.com.evil.io"));
    assert.ok(!isDiscordHost(""));
});

test("isMainDiscordPage", () => {
    assert.ok(isMainDiscordPage("/channels/@me"));
    assert.ok(isMainDiscordPage("/app"));
    assert.ok(!isMainDiscordPage("/popout"));
    assert.ok(!isMainDiscordPage("/overlay"));
});

test("allowedRelay so libera os relays da lista", () => {
    assert.ok(allowedRelay("wss://relay.damus.io"));
    assert.ok(!allowedRelay("wss://evil.example"));
    assert.ok(!allowedRelay("ws://relay.damus.io"));
    assert.ok(!allowedRelay("wss://relay.damus.io/../x"));
    assert.ok(!allowedRelay(42));
});

test("lista da ponte e a do plugin sao a mesma", () => {
    assert.deepEqual([...RELAY_URLS].sort(), [...RELAYS].sort());
});

const PLUGIN = "/**\n * @name P2PShare\n * @version 1.21.3\n */\nmodule.exports = class {};\n" + "x".repeat(2000);
const OLDER = PLUGIN.replace("1.21.3", "1.21.2");

test("plugin bom: carrega o atual", () => {
    assert.deepEqual(choosePluginSource(PLUGIN, OLDER), { source: PLUGIN, from: "current" });
});

test("plugin vazio (desligamento no meio da atualização): volta para a última cópia boa", () => {
    assert.deepEqual(choosePluginSource("", OLDER), { source: OLDER, from: "lastGood" });
    assert.deepEqual(choosePluginSource(null, OLDER), { source: OLDER, from: "lastGood" });
});

test("plugin corrompido ou cortado ao meio: volta para a última cópia boa", () => {
    assert.deepEqual(choosePluginSource("\0\0\0\0", OLDER), { source: OLDER, from: "lastGood" });
    assert.deepEqual(choosePluginSource(PLUGIN.slice(0, 500), OLDER), { source: OLDER, from: "lastGood" });
    assert.deepEqual(choosePluginSource("<html>404</html>".repeat(100), OLDER), { source: OLDER, from: "lastGood" });
});

test("sem nada bom: não carrega nada (o Discord abre sem o P2PShare)", () => {
    assert.equal(choosePluginSource("", ""), null);
    assert.equal(choosePluginSource(null, null), null);
});
