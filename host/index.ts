/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Ponto de troca entre os client mods.
 *
 * O build do Vencord usa este arquivo como está. O build do BetterDiscord
 * (scripts/build-bd.mjs) resolve este caminho para ./bd em vez de ./vencord,
 * então o bundle do BD nunca chega a importar nada do Vencord.
 */

export type { BeaconNotice, Host, HostMessage, ToastKind } from "./types";
export { host } from "./vencord";
