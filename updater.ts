/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Lógica pura da atualização automática.
 *
 * Fica separada do I/O para poder ser testada: escrever por cima do próprio
 * arquivo do plugin é a operação mais destrutiva que este código faz, e a
 * decisão de escrever ou não precisa ser verificável sem tocar em disco.
 */

/** Lê o `@version` do cabeçalho de metadados do BetterDiscord. */
export function parseMetaVersion(source: string): string | null {
    const match = source.match(/@version\s+([^\s*]+)/);
    return match ? match[1] : null;
}

function parts(version: string): number[] | null {
    if (!version) return null;

    const nums = version.split(".").map(p => Number.parseInt(p, 10));
    if (nums.some(n => !Number.isFinite(n))) return null;

    return nums;
}

/**
 * `remote` é mais nova que `local`?
 *
 * Compara número a número: em ordem alfabética "1.10.0" viria antes de
 * "1.9.0", e o update nunca chegaria.
 *
 * Versão ilegível responde false. Na dúvida, não sobrescrever.
 */
export function isNewer(remote: string, local: string): boolean {
    const a = parts(remote);
    const b = parts(local);
    if (!a || !b) return false;

    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x !== y) return x > y;
    }

    return false;
}

/**
 * O que baixamos parece mesmo este plugin?
 *
 * Sem esta checagem, um host fora do ar devolvendo uma página de erro em HTML
 * substituiria o plugin por lixo, e o BetterDiscord carregaria isso na próxima
 * vez. É barato conferir antes de escrever.
 */
export function looksLikePlugin(source: string, expectedName: string): boolean {
    if (source.length < 1000) return false;
    if (!source.includes("module.exports")) return false;

    const name = source.match(/@name\s+([^\s*]+)/);
    if (!name || name[1] !== expectedName) return false;

    return parseMetaVersion(source) !== null;
}
