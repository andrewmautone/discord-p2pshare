import assert from "node:assert/strict";
import { test } from "node:test";

import { allowedUrl, insideRoot, isAppVersionDir, isMainDiscordPage } from "./guards";

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
});

test("isMainDiscordPage", () => {
    assert.ok(isMainDiscordPage("/channels/@me"));
    assert.ok(isMainDiscordPage("/app"));
    assert.ok(!isMainDiscordPage("/popout"));
    assert.ok(!isMainDiscordPage("/overlay"));
});
