/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Normaliza para bytes o que uma leitura de arquivo devolveu.
 *
 * O `fs` que o BetterDiscord entrega ao plugin não é o do Node: `readFileSync`
 * sem encoding devolve **texto decodificado como UTF-8** em vez de um Buffer.
 * Num executável isso é destrutivo — toda sequência inválida vira U+FFFD, e o
 * conteúdo não volta mais. Medido no auxiliar de áudio: 173568 bytes viraram
 * 171890 caracteres, e o SHA-256 nunca batia.
 *
 * Lido como latin1 cada caractere é exatamente um byte, e daí a conversão é
 * fiel. Esta função aceita as duas formas para não depender de qual delas o
 * ambiente resolveu devolver.
 */
export function toBytes(data: Uint8Array | string): Uint8Array {
    if (typeof data !== "string") return new Uint8Array(data);

    const bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;

    return bytes;
}
