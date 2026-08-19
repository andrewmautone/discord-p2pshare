/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CaptureSource } from "../capture";

/**
 * Tudo que o plugin precisa do client mod hospedeiro.
 *
 * Existe para que a lógica (protocolo, WebRTC, orquestração) não saiba em qual
 * mod está rodando. Vencord e BetterDiscord fornecem uma implementação cada, e
 * o build escolhe qual entra no bundle.
 */

export interface HostMessage {
    id: string;
    channel_id: string;
    content: string;
    author: { id: string; username: string; };
    attachments?: { filename: string; url: string; }[];
}

export type ToastKind = "info" | "success" | "error";

/** O que o host precisa saber para anunciar uma transmissão disponível. */
export interface BeaconNotice {
    sessionId: string;
    broadcasterName: string;
}

export interface OverlayOptions {
    /**
     * Silencia o áudio local. Obrigatório na prévia da própria tela: sem isso
     * o áudio do sistema volta pelos alto-falantes e microfona.
     */
    muted?: boolean;
    /** Texto do botão de fechar. O padrão não diz o que realmente acontece. */
    closeLabel?: string;
}

export interface Host {
    // --- identidade e contexto ---
    getCurrentUserId(): string;
    getCurrentUsername(): string;
    /** Nome de exibição de um usuário. Cai no próprio id se não conhecer. */
    getUsername(userId: string): string;
    /** Canal de voz em que o usuário está, ou null. */
    getVoiceChannelId(): string | null;

    // --- mensagens ---
    sendMessage(channelId: string, content: string): Promise<string>;
    deleteMessage(channelId: string, messageId: string): Promise<void>;
    uploadTextAttachment(
        channelId: string,
        filename: string,
        text: string,
        content: string
    ): Promise<void>;
    fetchAttachmentText(url: string): Promise<string>;
    /** Canal de DM com o usuário, ou null quando o Discord não deixa abrir. */
    openDm(userId: string): Promise<string | null>;

    onMessageCreate(handler: (message: HostMessage) => void): () => void;
    onMessageDelete(handler: (channelId: string, messageId: string) => void): () => void;

    // --- interface ---
    toast(message: string, kind: ToastKind): void;
    /** Orçamento de upload configurado pelo usuário, em Mbps. */
    getBudgetMbps(): number;
    /** Abre o seletor de tela/janela. Resolve com null se o usuário cancelar. */
    pickSource(sources: CaptureSource[]): Promise<string | null>;

    mountOverlay(
        sessionId: string,
        stream: MediaStream,
        title: string,
        onClose: () => void,
        opts?: OverlayOptions
    ): void;
    unmountOverlay(sessionId: string): void;
    unmountAllOverlays(): void;

    /**
     * Lista quem está assistindo, dentro da janela de prévia do emissor.
     * Lista vazia significa ninguém conectado ainda.
     */
    setOverlayViewers(sessionId: string, names: string[]): void;

    /**
     * Avisa que existe uma transmissão para assistir.
     *
     * No Vencord isso é no-op: o botão "Assistir" é renderizado direto na
     * mensagem pela API de accessories. No BetterDiscord, que não tem essa
     * API, vira uma notificação clicável.
     */
    announceBeacon(notice: BeaconNotice, onWatch: () => void): void;
    /** Retira o aviso quando a transmissão acaba. */
    revokeBeacon(sessionId: string): void;

    /**
     * Marca quem está transmitindo na lista de participantes do canal de voz.
     * Cada entrada traz o id e os nomes possíveis, porque o painel mostra ora
     * o nome de exibição, ora o username.
     */
    setLiveUsers(users: { id: string; names: string[]; }[]): void;
}
