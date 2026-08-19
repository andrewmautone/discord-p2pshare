/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare const BdApi: any;

/**
 * Armazenamento de configurações do BetterDiscord.
 *
 * Módulo próprio para o updater poder ler uma preferência sem arrastar junto
 * a UI e os módulos do Discord que o host principal importa.
 */

const STORE = "P2PShare";

export function loadSetting<T>(key: string, fallback: T): T {
    const value = BdApi.Data.load(STORE, key);
    return value === undefined || value === null ? fallback : (value as T);
}

export function saveSetting(key: string, value: unknown): void {
    BdApi.Data.save(STORE, key, value);
}
