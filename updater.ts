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
 * Lê o arquivo `VERSION` publicado ao lado do plugin.
 *
 * É o que a checagem frequente baixa: poucos bytes em vez do plugin inteiro.
 * Só aceita algo com cara de versão; qualquer outra resposta (página de
 * erro, HTML de um host fora do ar) vale como "não sei", e não atualiza.
 */
export function parseVersionFile(text: string): string | null {
    const v = text.trim();
    return /^\d+(\.\d+){0,3}$/.test(v) ? v : null;
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

function fromBase64(text: string): Uint8Array {
    return Uint8Array.from(atob(text), char => char.charCodeAt(0));
}

/**
 * O plugin baixado foi assinado pela chave privada do projeto?
 *
 * `looksLikePlugin` só separa plugin de página de erro; quem pode escrever no
 * repo passaria por ele. A assinatura cobre exatamente os bytes publicados.
 *
 * Qualquer falha responde false, inclusive chave ainda não embutida no build:
 * na dúvida, não sobrescrever.
 */
export async function verifyPluginSignature(
    source: string,
    signature: string,
    publicKey: string
): Promise<boolean> {
    try {
        const key = await crypto.subtle.importKey(
            "spki",
            fromBase64(publicKey) as BufferSource,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["verify"]
        );

        return await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            key,
            fromBase64(signature.trim()) as BufferSource,
            new TextEncoder().encode(source) as BufferSource
        );
    } catch {
        return false;
    }
}

export type UpdateCandidate = {
    source: string;
    signature: string | null;
    publicKey: string;
    pluginName: string;
    currentVersion: string;
};

/**
 * Decide se o que foi baixado pode substituir o plugin.
 *
 * Devolve a versão nova ou null. Fica aqui, e não no host, para a decisão de
 * sobrescrever ser testada sem tocar em disco nem no BetterDiscord.
 */
export async function vetUpdate(candidate: UpdateCandidate): Promise<string | null> {
    const { source, signature, publicKey, pluginName, currentVersion } = candidate;

    if (!looksLikePlugin(source, pluginName)) return null;

    const remote = parseMetaVersion(source);
    if (!remote || !isNewer(remote, currentVersion)) return null;

    if (signature === null) return null;

    return await verifyPluginSignature(source, signature, publicKey) ? remote : null;
}
