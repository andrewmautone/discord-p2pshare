import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error modulo .mjs sem tipos
import { packAsar, unpackAsar } from "../scripts/asar.mjs";

test("asar ida e volta", () => {
    const buf: Uint8Array = packAsar({ "index.js": "console.log('oi');", "package.json": "{\"main\":\"index.js\"}" });
    const files = unpackAsar(buf);
    const dec = new TextDecoder();
    assert.equal(dec.decode(files["index.js"]), "console.log('oi');");
    assert.equal(dec.decode(files["package.json"]), "{\"main\":\"index.js\"}");
});

test("cabecalho no formato do Electron", () => {
    const buf: Uint8Array = packAsar({ "a.js": "x" });
    const v = new DataView(buf.buffer, buf.byteOffset);
    assert.equal(v.getUint32(0, true), 4);
    const headerSize = v.getUint32(4, true);
    assert.equal(v.getUint32(8, true), headerSize - 4);
    assert.equal(headerSize % 4, 0);
    assert.equal(buf.length, 8 + headerSize + 1);
});

test("recusa pastas", () => {
    assert.throws(() => packAsar({ "x/y.js": "" }));
});
