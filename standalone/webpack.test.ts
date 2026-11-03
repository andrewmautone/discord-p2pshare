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

/** Imita o proxy de traducoes do Discord: qualquer chave devolve uma funcao. */
function intlProxy(): unknown {
    return new Proxy({}, {
        get(_t, key) {
            if (key === Symbol.toStringTag) return "IntlMessagesProxy";
            return () => ({ locale: "en-US", ast: [] });
        }
    });
}

test("pula o IntlMessagesProxy, que casaria com qualquer filtro", () => {
    const realStore = { getCurrentUser: () => ({ id: "9" }), getUser: () => null };
    const withProxy = {
        // Vem antes de proposito: e assim no Discord real (modulo 2077).
        1: { exports: { default: intlProxy(), messagesLoader: {} } },
        2: { exports: { A: intlProxy() } },
        3: { exports: intlProxy() },
        4: { exports: { default: realStore } }
    };

    assert.equal(searchModules(withProxy, m => m?.getCurrentUser && m?.getUser), realStore);
    assert.equal(searchModules(withProxy, m => m?.getCurrentUser && m?.getUser, { searchExports: true }), realStore);
    assert.deepEqual(searchModules(withProxy, m => m?.getCurrentUser, { first: false }), [realStore]);
});
