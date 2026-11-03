import assert from "node:assert/strict";
import { test } from "node:test";

import { searchModules } from "./webpack";

const store = { getCurrentUser: () => ({ id: "1" }), getUser: () => null };
const playSound = Object.assign(() => {}, { marker: true });

const cache = {
    1: { exports: { default: store, __esModule: true } },
    2: { exports: { Ak: playSound, other: 1 } },
    3: { exports: null },
    4: undefined,
    5: { exports: { thrower: new Proxy({}, { get() { throw new Error("boom"); } }) } },
    6: { exports: { getCurrentUser: () => null, getUser: () => null, second: true } }
};

test("acha pelo default do modulo", () => {
    assert.equal(searchModules(cache, m => m?.getCurrentUser && m?.getUser), store);
});

test("defaultExport=false devolve o modulo inteiro", () => {
    assert.equal(
        searchModules(cache, m => m?.getCurrentUser && m?.getUser, { defaultExport: false }),
        cache[1].exports
    );
});

test("searchExports acha export solto, inclusive funcao", () => {
    assert.equal(searchModules(cache, m => m?.marker === true, { searchExports: true }), playSound);
    assert.equal(searchModules(cache, m => m?.marker === true), undefined);
});

test("first=false devolve todos", () => {
    const all = searchModules(cache, m => typeof m?.getCurrentUser === "function", { first: false });
    assert.equal(all.length, 2);
});

test("filtro que explode e proxy hostil nao derrubam a busca", () => {
    assert.equal(searchModules(cache, () => { throw new Error("x"); }), undefined);
    assert.equal(searchModules(cache, m => m?.second), cache[6].exports);
});

test("sem cache devolve vazio", () => {
    assert.equal(searchModules(null, () => true), undefined);
    assert.deepEqual(searchModules(undefined, () => true, { first: false }), []);
});
