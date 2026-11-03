/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { HostMessage } from "../types";

declare const BdApi: any;

/**
 * Acesso aos módulos internos do Discord pelo BetterDiscord.
 *
 * Cada lookup é preguiçoso e memoizado: procurar no webpack é caro, e no
 * momento em que o plugin carrega nem todos os módulos existem ainda.
 *
 * Um mesmo módulo pode estar exposto de formas diferentes conforme a versão do
 * Discord — direto no export, dentro de `default`, ou só alcançável varrendo
 * os exports um a um. Por isso cada busca tenta várias estratégias antes de
 * desistir, e o erro diz QUAL módulo faltou: sem o nome, o stack trace do
 * BetterDiscord não permite diagnosticar nada.
 */
const { getModule } = BdApi.Webpack;

type Filter = (m: any) => boolean;

/**
 * Objetos que dizem "sim" a qualquer filtro e nunca são o que procuramos.
 *
 * O caso real é o proxy de traduções do Discord: qualquer propriedade dele
 * devolve uma função, então `m?.getCurrentUser && m?.getUser` casa com ele
 * antes do UserStore. O BetterDiscord pula esse proxy, mas um carregador que
 * não pule entregaria lixo no lugar de todo store — e nada funcionaria.
 */
export function isImpostor(m: any): boolean {
    try {
        if (m === window || m === document) return true;
        if (m?.[Symbol.toStringTag] === "IntlMessagesProxy") return true;
        // Qualquer outro proxy "responde tudo" também se denuncia assim.
        return m != null && typeof m === "object"
            && m["__p2pshare_inexistente__"] !== undefined;
    } catch {
        return true;
    }
}

function guard(filter: Filter): Filter {
    return m => !isImpostor(m) && filter(m);
}

function lookup(rawFilter: Filter): any {
    const filter = guard(rawFilter);
    // 1. export direto
    let found = getModule(filter);

    // 2. varrendo cada export do módulo
    if (found === undefined) {
        found = getModule(filter, { searchExports: true });
    }

    // 3. módulo cujo conteúdo real está em `default`
    if (found === undefined) {
        const wrapper = getModule((m: any) => m?.default && filter(m.default));
        if (wrapper) found = wrapper.default;
    }

    return found ?? undefined;
}

function find(name: string, filter: Filter): () => any {
    let cached: any;

    return () => {
        if (cached !== undefined) return cached;

        cached = lookup(filter);

        if (cached === undefined) {
            throw new Error(
                `[P2PShare] não encontrei o módulo ${name} no Discord. ` +
                "Provavelmente o Discord mudou a estrutura interna — reporte com este nome."
            );
        }

        return cached;
    };
}

/**
 * Igual a `find`, mas devolve undefined em vez de explodir.
 *
 * Para módulos de que o plugin só tira proveito quando existem: a ausência
 * degrada um recurso, não impede o plugin de funcionar.
 */
function findOptional(filter: Filter): () => any {
    let cached: any;
    let resolved = false;

    return () => {
        if (resolved) return cached;
        resolved = true;

        try {
            cached = lookup(filter);
        } catch {
            cached = undefined;
        }

        return cached;
    };
}

const UserStore = find("UserStore",
    m => m?.getCurrentUser && m?.getUser);

const SelectedChannelStore = find("SelectedChannelStore",
    m => m?.getVoiceChannelId && m?.getChannelId);

const FluxDispatcher = find("FluxDispatcher",
    m => m?.dispatch && m?.subscribe && m?.unsubscribe);

const RestAPI = find("RestAPI",
    m => typeof m === "object" && m?.del && m?.put && m?.post);

const CloudUpload = find("CloudUpload",
    m => m?.prototype?.trackUploadFinished);

const MessageStore = findOptional(
    m => m?.getMessages && m?.getMessage && m?.getLastMessage);

/** Snowflake a partir do relógio, para o nonce da mensagem. */
function nonce(): string {
    const DISCORD_EPOCH = 1420070400000n;
    return ((BigInt(Date.now()) - DISCORD_EPOCH) << 22n).toString();
}

/** O Discord já tem o usuário logado? Antes disso o plugin não inicia. */
export function hasCurrentUser(): boolean {
    try {
        return Boolean(UserStore().getCurrentUser()?.id);
    } catch {
        return false;
    }
}

export function getCurrentUserId(): string {
    return UserStore().getCurrentUser().id;
}

export function getCurrentUsername(): string {
    return UserStore().getCurrentUser().username;
}

/**
 * Nome de exibição de um usuário qualquer.
 *
 * Quem acabou de entrar no canal pode ainda não estar no store — nesse caso
 * mostrar o id cru é melhor que quebrar a lista inteira.
 */
export function getUsername(userId: string): string {
    try {
        const user = UserStore().getUser(userId);
        return user?.globalName || user?.username || userId;
    } catch {
        return userId;
    }
}

export function getVoiceChannelId(): string | null {
    return SelectedChannelStore().getVoiceChannelId() ?? null;
}

export async function sendMessage(channelId: string, content: string): Promise<string> {
    const res = await RestAPI().post({
        url: `/channels/${channelId}/messages`,
        body: {
            channel_id: channelId,
            content,
            nonce: nonce(),
            sticker_ids: [],
            type: 0
        }
    });

    return res.body.id as string;
}

const dmCache = new Map<string, string>();

/**
 * Abre (ou reusa) a DM com um usuário e devolve o id do canal.
 *
 * Devolve null quando o Discord recusa — DM fechada, bloqueio, sem servidor
 * em comum. Quem chama trata isso como "use o canal público".
 *
 * O id é memoizado: o Discord devolve sempre o mesmo canal, e cada handshake
 * faria uma chamada à toa.
 */
export async function openDm(userId: string): Promise<string | null> {
    const cached = dmCache.get(userId);
    if (cached) return cached;

    try {
        const res = await RestAPI().post({
            url: "/users/@me/channels",
            body: { recipient_id: userId }
        });

        const id = res.body?.id as string | undefined;
        if (!id) return null;

        dmCache.set(userId, id);
        return id;
    } catch (err) {
        console.warn("[P2PShare] não deu para abrir DM", err);
        return null;
    }
}

export async function deleteMessage(channelId: string, messageId: string): Promise<void> {
    await RestAPI().del({ url: `/channels/${channelId}/messages/${messageId}` });
}

/**
 * Sobe um .txt e posta a mensagem que o referencia.
 *
 * Mesmo caminho da versão Vencord: o CloudUpload do Discord sobe o arquivo e
 * devolve o `uploadedFilename`, que a mensagem então referencia.
 */
export function uploadTextAttachment(
    channelId: string,
    filename: string,
    text: string,
    content: string
): Promise<void> {
    return new Promise((resolve, reject) => {
        const Upload = CloudUpload() as any;

        const upload = new Upload({
            file: new File([text], filename, { type: "text/plain" }),
            isThumbnail: false,
            platform: 1
        }, channelId);

        upload.on("complete", () => {
            RestAPI().post({
                url: `/channels/${channelId}/messages`,
                body: {
                    channel_id: channelId,
                    content,
                    nonce: nonce(),
                    sticker_ids: [],
                    type: 0,
                    attachments: [{
                        id: "0",
                        filename: upload.filename,
                        uploaded_filename: upload.uploadedFilename
                    }]
                }
            }).then(() => resolve(), reject);
        });

        upload.on("error", () => reject(new Error("falha ao subir o anexo")));

        upload.upload();
    });
}

export async function fetchAttachmentText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`anexo respondeu ${res.status}`);
    return res.text();
}

/** Quantas mensagens olhar para trás ao varrer um canal. */
const HISTORY_LIMIT = 50;

/**
 * Mensagens recentes do canal, da mais nova para a mais antiga.
 *
 * Tenta primeiro o cache do Discord, que é instantâneo e não gasta cota de
 * requisição — quem já tinha o canal aberto costuma ter tudo ali. Só cai na
 * rede quando o cache não existe ou ainda não terminou de carregar.
 *
 * Nunca propaga erro: a varredura é um extra sobre a descoberta ao vivo, e
 * derrubar a entrada no canal de voz por causa dela seria um péssimo negócio.
 */
export async function fetchRecentMessages(
    channelId: string,
    limit: number = HISTORY_LIMIT
): Promise<HostMessage[]> {
    const cached = readCachedMessages(channelId, limit);
    if (cached.length > 0) return cached;

    try {
        const rest = RestAPI();
        // O módulo é achado por `del`/`put`/`post`; `get` é o único verbo que
        // este arquivo usa sem tê-lo exigido no filtro.
        if (typeof rest.get !== "function") return [];

        const res = await rest.get({
            url: `/channels/${channelId}/messages?limit=${limit}`
        });

        // A REST já devolve da mais nova para a mais antiga.
        return normalizeMessages(res?.body, channelId, limit);
    } catch (err) {
        console.warn("[P2PShare] não deu para buscar o histórico do canal", err);
        return [];
    }
}

function readCachedMessages(channelId: string, limit: number): HostMessage[] {
    try {
        const store = MessageStore();
        if (!store) return [];

        const cache = store.getMessages(channelId);
        // `ready` falso significa canal a meio carregar: o que houver ali é
        // um retrato parcial, e a rede devolve melhor.
        if (!cache || cache.ready === false) return [];

        // O cache guarda da mais antiga para a mais nova; invertemos para que
        // as duas estratégias entreguem a mesma ordem a quem chama.
        const list = toArray(cache).slice(-limit).reverse();
        return normalizeMessages(list, channelId, limit);
    } catch (err) {
        console.warn("[P2PShare] cache de mensagens indisponível", err);
        return [];
    }
}

/** O cache do Discord já apareceu como array puro, com `toArray` e com `_array`. */
function toArray(cache: any): any[] {
    if (Array.isArray(cache)) return cache;
    if (typeof cache.toArray === "function") return cache.toArray() ?? [];
    if (Array.isArray(cache._array)) return cache._array;
    return [];
}

function normalizeMessages(raw: any, channelId: string, limit: number): HostMessage[] {
    if (!Array.isArray(raw)) return [];

    const out: HostMessage[] = [];

    for (const m of raw.slice(0, limit)) {
        if (typeof m?.id !== "string" || typeof m?.content !== "string") continue;
        if (typeof m?.author?.id !== "string") continue;

        out.push({
            id: m.id,
            // Registro de cache nem sempre carrega o canal; sem ele o
            // handshake sairia sem destino, então o canal pedido é a verdade.
            channel_id: m.channel_id ?? m.channelId ?? channelId,
            content: m.content,
            author: { id: m.author.id, username: m.author.username ?? m.author.id },
            attachments: Array.isArray(m.attachments) ? m.attachments : []
        });
    }

    return out;
}

export function onMessageCreate(handler: (message: HostMessage) => void): () => void {
    const listener = (event: { message: HostMessage; }) => {
        try {
            handler(event.message);
        } catch (err) {
            console.error("[P2PShare] handler de MESSAGE_CREATE falhou", err);
        }
    };

    FluxDispatcher().subscribe("MESSAGE_CREATE", listener);
    return () => FluxDispatcher().unsubscribe("MESSAGE_CREATE", listener);
}


/**
 * Entrada, saida e troca de canal de voz.
 *
 * O Discord dispara VOICE_CHANNEL_SELECT com channelId null ao desconectar.
 */
export function onVoiceChannelChange(
    handler: (channelId: string | null) => void
): () => void {
    const listener = (event: { channelId?: string | null; }) => {
        try {
            handler(event.channelId ?? null);
        } catch (err) {
            console.error("[P2PShare] handler de VOICE_CHANNEL_SELECT falhou", err);
        }
    };

    FluxDispatcher().subscribe("VOICE_CHANNEL_SELECT", listener);
    return () => FluxDispatcher().unsubscribe("VOICE_CHANNEL_SELECT", listener);
}

export function onMessageDelete(
    handler: (channelId: string, messageId: string) => void
): () => void {
    const listener = (event: { channelId: string; id: string; }) => {
        try {
            handler(event.channelId, event.id);
        } catch (err) {
            console.error("[P2PShare] handler de MESSAGE_DELETE falhou", err);
        }
    };

    FluxDispatcher().subscribe("MESSAGE_DELETE", listener);
    return () => FluxDispatcher().unsubscribe("MESSAGE_DELETE", listener);
}

// --- aviso pelo status ("Jogando P2PShare") ---

/** Store pelo nome que o próprio Discord dá a ele — o filtro mais estável. */
function byStoreName(name: string): Filter {
    return m => typeof m?.getName === "function" && m.getName() === name;
}

const VoiceStateStore = findOptional(byStoreName("VoiceStateStore"));

const PresenceStore = findOptional(byStoreName("PresenceStore"));

/** Guarda "Compartilhar minha atividade" em settings.status.showCurrentGame. */
const UserSettingsProtoStore = findOptional(byStoreName("UserSettingsProtoStore"));

/** Identifica a nossa atividade entre as outras que o Discord mantém localmente. */
const ACTIVITY_SOCKET = "P2PShare";

/**
 * Publica (ou retira, com null) a atividade de transmissão.
 *
 * Mesmo caminho que o Discord usa para atividades locais (RPC de jogos): o
 * cliente junta tudo e manda no presence do gateway. Devolve false se o
 * despacho falhou — aí quem chama recorre à mensagem no chat.
 */
export function setBroadcastActivity(activity: object | null): boolean {
    try {
        FluxDispatcher().dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            activity,
            socketId: ACTIVITY_SOCKET
        });
        return true;
    } catch (err) {
        console.warn("[P2PShare] não deu para publicar o status", err);
        return false;
    }
}

/** null quando a configuração não foi encontrada (não dá para afirmar nada). */
export function isActivitySharingEnabled(): boolean | null {
    try {
        const value = UserSettingsProtoStore()?.settings?.status?.showCurrentGame?.value;
        return typeof value === "boolean" ? value : null;
    } catch {
        return null;
    }
}

/** Membros do canal de voz, com as atividades que o Discord conhece de cada um. */
export function getVoiceChannelMembers(channelId: string): {
    userId: string;
    username: string;
    activities: unknown[];
}[] {
    const voice = VoiceStateStore();
    const presence = PresenceStore();
    if (!voice || !presence) return [];

    let states: any;
    try {
        states = voice.getVoiceStatesForChannel(channelId);
    } catch {
        return [];
    }

    const ids = new Set<string>();
    const list = Array.isArray(states) ? states
        : states instanceof Map ? [...states.values()]
            : Object.values(states ?? {});

    for (const s of list as any[]) {
        const id = s?.userId ?? s?.user_id ?? s?.user?.id;
        if (typeof id === "string") ids.add(id);
    }
    // Store indexado por userId com valor sem o campo: as chaves bastam.
    if (ids.size === 0 && states && !Array.isArray(states) && !(states instanceof Map)) {
        for (const key of Object.keys(states)) if (/^\d+$/.test(key)) ids.add(key);
    }

    return [...ids].map(userId => {
        let activities: unknown[] = [];
        try {
            activities = presence.getActivities(userId) ?? [];
        } catch { /* sem presence: sem atividades */ }

        return { userId, username: getUsername(userId), activities };
    });
}

/**
 * Qualquer mudança que possa acender ou apagar um aviso: presença de alguém,
 * gente entrando ou saindo da voz.
 */
export function onPresenceChange(handler: () => void): () => void {
    const events = ["PRESENCE_UPDATES", "PRESENCES_REPLACE", "VOICE_STATE_UPDATES"];
    const listener = () => {
        try {
            handler();
        } catch (err) {
            console.error("[P2PShare] handler de presença falhou", err);
        }
    };

    for (const e of events) FluxDispatcher().subscribe(e, listener);
    return () => {
        for (const e of events) FluxDispatcher().unsubscribe(e, listener);
    };
}
