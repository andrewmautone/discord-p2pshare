/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CaptureChoice, CaptureSource } from "../../capture";
import { helperReady, nativeAudioBlocked } from "./audioHelper";

declare const BdApi: any;

/**
 * UI do BetterDiscord, em DOM puro.
 *
 * O BD não tem API para injetar botão na barra do chat nem acessório em
 * mensagem — só sobraria patchar componentes do Discord por assinatura, que é
 * exatamente a fragilidade que queremos evitar. Então a UI é toda nossa:
 * um botão flutuante e janelas próprias, que não dependem de achar nada no
 * bundle do Discord e portanto não quebram quando ele atualiza.
 */

const CSS = `
.p2ps-launcher {
    position: fixed;
    z-index: 4000;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--background-floating, #18191c);
    box-shadow: 0 4px 12px rgb(0 0 0 / 40%);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--interactive-normal, #b9bbbe);
    user-select: none;
}
.p2ps-launcher:hover { color: var(--interactive-hover, #fff); }
.p2ps-launcher-live { color: var(--status-danger, #ed4245); }
.p2ps-launcher svg { width: 22px; height: 22px; pointer-events: none; }
.p2ps-launcher-count {
    position: absolute;
    bottom: -2px;
    right: -2px;
    background: var(--status-danger, #ed4245);
    color: #fff;
    border-radius: 8px;
    font-size: 11px;
    line-height: 16px;
    min-width: 16px;
    text-align: center;
    padding: 0 4px;
}

.p2ps-backdrop {
    position: fixed;
    inset: 0;
    z-index: 4100;
    background: rgb(0 0 0 / 70%);
    display: flex;
    align-items: center;
    justify-content: center;
}
.p2ps-dialog {
    background: var(--background-primary, #36393f);
    border-radius: 8px;
    width: min(900px, 90vw);
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    color: var(--header-primary, #fff);
}
.p2ps-dialog-head { padding: 16px; font-size: 18px; font-weight: 600; }
.p2ps-dialog-body { padding: 0 16px; overflow-y: auto; flex: 1; }
.p2ps-dialog-foot {
    padding: 16px;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    background: var(--background-secondary, #2f3136);
    border-radius: 0 0 8px 8px;
}
.p2ps-btn {
    padding: 8px 16px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 14px;
    color: #fff;
    background: var(--brand-experiment, #5865f2);
}
.p2ps-btn-secondary { background: transparent; }
.p2ps-btn:disabled { opacity: .5; cursor: not-allowed; }
.p2ps-tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.p2ps-tab {
    padding: 6px 12px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    background: var(--background-secondary, #2f3136);
    color: var(--interactive-normal, #b9bbbe);
    font-size: 13px;
}
.p2ps-tab-active { background: var(--brand-experiment, #5865f2); color: #fff; }

.p2ps-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    padding-bottom: 12px;
}
.p2ps-card {
    border: 2px solid transparent;
    border-radius: 8px;
    padding: 6px;
    cursor: pointer;
    background: var(--background-secondary, #2f3136);
}
.p2ps-card:hover { background: var(--background-modifier-hover, #3a3c43); }
.p2ps-card-selected { border-color: var(--brand-experiment, #5865f2); }
.p2ps-card-thumb {
    aspect-ratio: 16/9;
    background: #000;
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted, #72767d);
    font-size: 12px;
}
.p2ps-card-thumb img { width: 100%; height: 100%; object-fit: contain; }
.p2ps-card-name {
    margin-top: 6px;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.p2ps-overlay {
    position: fixed;
    z-index: 4000;
    background: var(--background-tertiary, #202225);
    border-radius: 8px;
    box-shadow: 0 8px 16px rgb(0 0 0 / 40%);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    resize: both;
    min-width: 240px;
    min-height: 160px;
}
.p2ps-overlay-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    cursor: move;
    background: var(--background-secondary-alt, #292b2f);
    color: var(--header-primary, #fff);
    font-size: 13px;
    user-select: none;
}
.p2ps-overlay-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.p2ps-live {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--status-danger, #ed4245);
    color: #fff;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .06em;
    flex-shrink: 0;
}
.p2ps-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #fff;
    animation: p2ps-pulse 2s ease-in-out infinite;
}
@keyframes p2ps-pulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
@media (prefers-reduced-motion: reduce) { .p2ps-live-dot { animation: none } }
.p2ps-vol { width: 64px; accent-color: var(--brand-experiment, #5865f2); }
.p2ps-viewers {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 7px 9px;
    background: var(--background-secondary-alt, #292b2f);
    border-top: 1px solid var(--background-tertiary, #202225);
    font-size: 12px;
}
.p2ps-viewers-label {
    color: var(--text-muted, #72767d);
    text-transform: uppercase;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .06em;
}
.p2ps-viewer-chip {
    background: var(--background-tertiary, #202225);
    color: var(--header-primary, #fff);
    border-radius: 10px;
    padding: 2px 9px;
}
.p2ps-overlay-bar button:disabled { opacity: .4; cursor: default; }
.p2ps-voice-btn { position: relative; }
/* As classes do Discord nao dimensionam o icone: o SVG deles carrega
   width/height proprios. Sem isto o botao existe com 0 pixel. */
.p2ps-voice-btn svg { width: 20px; height: 20px; }
.p2ps-voice-count {
    position: absolute;
    bottom: 0;
    right: 0;
    background: var(--status-danger, #ed4245);
    color: #fff;
    border-radius: 8px;
    font-size: 10px;
    line-height: 14px;
    min-width: 14px;
    text-align: center;
    padding: 0 3px;
    pointer-events: none;
}
.p2ps-launcher-hidden { display: none; }
.p2ps-menu {
    position: fixed;
    z-index: 4200;
    min-width: 220px;
    padding: 6px;
    border-radius: 8px;
    background: var(--background-floating, #18191c);
    box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
    color: var(--header-primary, #fff);
    font-size: 14px;
}
.p2ps-menu-item {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 9px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
}
.p2ps-menu-item:hover { background: var(--brand-experiment, #5865f2); }
.p2ps-menu-value { color: var(--text-muted, #b5bac1); font-size: 13px; }
.p2ps-menu-item:hover .p2ps-menu-value { color: #fff; }
.p2ps-menu-check { width: 12px; text-align: right; }
.p2ps-menu-sep {
    height: 1px;
    margin: 5px 4px;
    background: var(--background-modifier-accent, #3f4147);
}
.p2ps-menu-danger { color: var(--status-danger, #ed4245); }
.p2ps-menu-danger:hover { background: var(--status-danger, #ed4245); color: #fff; }
.p2ps-submenu {
    display: none;
    position: absolute;
    left: 100%;
    top: -6px;
    margin-left: 4px;
    min-width: 150px;
    padding: 6px;
    border-radius: 8px;
    background: var(--background-floating, #18191c);
    box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
}
.p2ps-menu-parent:hover > .p2ps-submenu { display: block; }

.p2ps-clickable { cursor: pointer; }
.p2ps-clickable:hover { filter: brightness(1.15); }
.p2ps-tile-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
    z-index: 1;
    border-radius: inherit;
}
.p2ps-tile-bar {
    position: absolute;
    right: 8px;
    bottom: 8px;
    z-index: 3;
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 6px;
    background: rgb(0 0 0 / 65%);
    opacity: 0;
    transition: opacity .15s;
}
[class*="tileChild"]:hover .p2ps-tile-bar { opacity: 1; }
.p2ps-tile-bar button {
    background: none;
    border: none;
    color: #fff;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 2px 4px;
}
.p2ps-tile-bar button:hover { color: var(--brand-experiment, #5865f2); }
.p2ps-tile-vol { width: 60px; accent-color: var(--brand-experiment, #5865f2); }
@media (prefers-reduced-motion: reduce) {
    .p2ps-tile-bar { transition: none; }
}
.p2ps-audio-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--header-primary, #fff);
    font-size: 13px;
    cursor: pointer;
}
.p2ps-audio-toggle input:disabled + span { color: var(--text-muted, #72767d); }
.p2ps-audio-toggle input { accent-color: var(--brand-experiment, #5865f2); }
.p2ps-foot-space { flex: 1; }
.p2ps-tile-cta {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 3;
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: none;
    border-radius: 8px;
    padding: 10px 18px;
    background: var(--status-danger, #ed4245);
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 14px rgb(0 0 0 / 45%);
    transition: transform .12s, filter .12s;
    white-space: nowrap;
}
.p2ps-tile-cta:hover { filter: brightness(1.12); transform: translate(-50%, -50%) scale(1.04); }
.p2ps-cta-play { font-size: 12px; }
@media (prefers-reduced-motion: reduce) {
    .p2ps-tile-cta { transition: none; }
    .p2ps-tile-cta:hover { transform: translate(-50%, -50%); }
}
.p2ps-tile-live {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 2;
    /* O overlay do Discord desliga eventos; o selo precisa reativar. */
    pointer-events: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    background: var(--status-danger, #ed4245);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: .04em;
    cursor: pointer;
    box-shadow: 0 2px 6px rgb(0 0 0 / 35%);
}
.p2ps-tile-live:hover:not(:disabled) { filter: brightness(1.15); }
.p2ps-tile-live:disabled { cursor: default; opacity: .9; }
.p2ps-live-chip {
    display: inline-flex;
    align-items: center;
    align-self: center;
    flex: 0 0 auto;
    vertical-align: middle;
    margin-left: 6px;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--status-danger, #ed4245);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .06em;
    line-height: 14px;
    white-space: nowrap;
}
.p2ps-overlay-bar button {
    background: none;
    border: none;
    color: var(--interactive-normal, #b9bbbe);
    cursor: pointer;
    font-size: 13px;
}
.p2ps-overlay video { flex: 1; width: 100%; background: #000; object-fit: contain; }
`;

const SCREENSHARE_SVG =
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M2 4.5C2 3.397 2.897 2.5 4 2.5H20C21.103 ' +
    "2.5 22 3.397 22 4.5V15.5C22 16.604 21.103 17.5 20 17.5H13V19.5H17V21.5H7V19.5H11V17.5H4C2.897 " +
    "17.5 2 16.604 2 15.5V4.5ZM13.2 14.3375V11.6C9.864 11.6 7.668 12.6625 6 15C6.672 11.6625 8.532 " +
    '8.3375 13.2 7.6625V5L18 9.6625L13.2 14.3375Z"/></svg>';

export function injectStyles(): void {
    BdApi.DOM.addStyle("P2PShare", CSS);
}

export function removeStyles(): void {
    closeBroadcastMenu();
    BdApi.DOM.removeStyle("P2PShare");
}

/** Deixa um elemento arrastável pela alça informada. */
function makeDraggable(el: HTMLElement, handle: HTMLElement, onDrop?: () => void): void {
    let offset: { x: number; y: number; } | null = null;

    handle.addEventListener("mousedown", e => {
        // A alca cobre a barra inteira, controles inclusive. Sem esta saida o
        // preventDefault abaixo engole o clique no botao e o arraste do slider.
        if ((e.target as HTMLElement)?.closest("button, input, select, a")) return;

        const rect = el.getBoundingClientRect();
        offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        e.preventDefault();
    });

    const move = (e: MouseEvent) => {
        if (!offset) return;
        el.style.left = `${e.clientX - offset.x}px`;
        el.style.top = `${e.clientY - offset.y}px`;
        el.style.right = "auto";
        el.style.bottom = "auto";
    };

    const up = () => {
        if (!offset) return;
        offset = null;
        onDrop?.();
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);

    (el as any).__p2psCleanupDrag = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
    };
}

// ---------------------------------------------------------------- launcher

let launcher: HTMLElement | null = null;

export function mountLauncher(opts: {
    position: { x: number; y: number; };
    onToggle: (anchor: HTMLElement) => void;
    onMoved: (pos: { x: number; y: number; }) => void;
}): void {
    unmountLauncher();

    const el = document.createElement("div");
    el.className = "p2ps-launcher";
    el.title = "Transmitir tela via P2P";
    el.innerHTML = SCREENSHARE_SVG;
    el.style.left = `${opts.position.x}px`;
    el.style.top = `${opts.position.y}px`;

    // Um arrasto não deve disparar o clique.
    let moved = false;
    el.addEventListener("mousedown", () => { moved = false; });
    el.addEventListener("mousemove", e => { if (e.buttons) moved = true; });
    el.addEventListener("click", () => { if (!moved) opts.onToggle(el); });

    makeDraggable(el, el, () => {
        opts.onMoved({ x: parseInt(el.style.left, 10), y: parseInt(el.style.top, 10) });
    });

    document.body.appendChild(el);
    launcher = el;
}

export function updateLauncher(state: { active: boolean; viewers: number; }): void {
    if (!launcher) return;

    launcher.classList.toggle("p2ps-launcher-live", state.active);
    launcher.title = state.active
        ? `Parar transmissão P2P — ${state.viewers} assistindo`
        : "Transmitir tela via P2P";

    launcher.querySelector(".p2ps-launcher-count")?.remove();
    if (state.active && state.viewers > 0) {
        const badge = document.createElement("span");
        badge.className = "p2ps-launcher-count";
        badge.textContent = String(state.viewers);
        launcher.appendChild(badge);
    }
}

/** Esconde o flutuante enquanto existe botao no painel de voz do Discord. */
export function setLauncherHidden(hidden: boolean): void {
    launcher?.classList.toggle("p2ps-launcher-hidden", hidden);
}

export function unmountLauncher(): void {
    if (!launcher) return;
    (launcher as any).__p2psCleanupDrag?.();
    launcher.remove();
    launcher = null;
}

// ------------------------------------------------- botao no painel de voz

/** elemento-âncora -> botao que injetamos por causa dele */
const voiceBtns = new Map<HTMLElement, HTMLElement>();
let voiceObserver: MutationObserver | null = null;
let lastState = { active: false, viewers: 0 };

function isVisible(el: HTMLElement | null): boolean {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
}

const isOurs = (el: Element | null) => !!el?.classList.contains("p2ps-voice-btn");

/**
 * Sobe ate' o nivel em que os controles sao irmaos.
 *
 * O Discord embrulha cada botao da barra em varios divs de um filho so'.
 * Inserir dentro desse embrulho empilha o botao embaixo do vizinho em vez de
 * ao lado; o lugar certo e' ao lado do bloco inteiro.
 */
function climbToPeer(el: HTMLElement): HTMLElement {
    let node = el;
    while (
        node.parentElement &&
        node.parentElement !== document.body &&
        node.parentElement.childElementCount === 1
    ) {
        node = node.parentElement;
    }
    return node;
}

interface Site {
    /** Elemento que identifica este ponto de injecao. */
    host: HTMLElement;
    /** De quem copiar as classes para o botao parecer nativo. */
    style: HTMLElement;
    place(btn: HTMLElement): void;
}

/**
 * Onde cabe um botao P2P.
 *
 * Dois lugares, com estruturas diferentes: a barra da chamada, onde cada
 * controle e' um bloco irmao, e o painel de voz do canto inferior esquerdo,
 * onde os botoes sao filhos diretos de um contêiner.
 */
function collectSites(): Site[] {
    const sites: Site[] = [];
    const anchors = new Set<HTMLElement>();

    for (const path of document.querySelectorAll('button svg path[d^="M2 4.5C2 3.397"]')) {
        const btn = path.closest("button");
        if (btn && !isOurs(btn)) anchors.add(btn as HTMLElement);
    }

    for (const btn of document.querySelectorAll<HTMLElement>("button[aria-label]")) {
        if (isOurs(btn)) continue;
        const label = (btn.getAttribute("aria-label") || "").toLowerCase();
        // Exige intencao de COMPARTILHAR: so' "tela" casaria com "Tela cheia".
        if (!/compartilh|share/.test(label)) continue;
        if (/cheia|fullscreen|convite|invite|link/.test(label)) continue;
        anchors.add(btn);
    }

    // 1. barra da chamada
    for (const anchor of anchors) {
        // No painel lateral os botoes ja' sao irmaos diretos; tratado abaixo.
        if (anchor.closest('[class*="actionButtons"]')) continue;

        const peer = climbToPeer(anchor);
        sites.push({
            host: anchor,
            style: anchor,
            place: btn => {
                const wrapper = document.createElement("div");
                wrapper.className = peer.className;
                wrapper.appendChild(btn);
                (btn as any).__p2psWrapper = wrapper;
                peer.insertAdjacentElement("afterend", wrapper);
            }
        });
    }

    // 2. painel de voz do canto inferior esquerdo
    for (const row of document.querySelectorAll<HTMLElement>('[class*="actionButtons"]')) {
        const sibling = [...row.querySelectorAll<HTMLElement>("button")].find(b => !isOurs(b));
        if (!sibling) continue;

        sites.push({
            host: row,
            style: sibling,
            place: btn => row.appendChild(btn)
        });
    }

    return sites;
}

function paintOne(btn: HTMLElement): void {
    const svg = btn.querySelector("svg") as SVGElement | null;
    if (svg) svg.style.color = lastState.active ? "var(--status-danger, #ed4245)" : "";

    const label = lastState.active
        ? `Parar transmissão P2P — ${lastState.viewers} assistindo`
        : "Transmitir tela via P2P";
    btn.setAttribute("aria-label", label);
    btn.title = label;

    btn.querySelector(".p2ps-voice-count")?.remove();
    if (lastState.active && lastState.viewers > 0) {
        const badge = document.createElement("span");
        badge.className = "p2ps-voice-count";
        badge.textContent = String(lastState.viewers);
        btn.appendChild(badge);
    }
}

function removeBtn(btn: HTMLElement): void {
    const wrapper = (btn as any).__p2psWrapper as HTMLElement | undefined;
    (wrapper ?? btn).remove();
}

export function mountVoiceButton(opts: {
    onToggle: (anchor: HTMLElement) => void;
    onAnchorChange: (visible: boolean) => void;
}): () => void {
    const sync = () => {
        for (const [host, btn] of voiceBtns) {
            if (!host.isConnected || !btn.isConnected) {
                removeBtn(btn);
                voiceBtns.delete(host);
            }
        }

        for (const site of collectSites()) {
            if (voiceBtns.has(site.host)) continue;

            const btn = document.createElement("button");
            // Herda as classes do vizinho: nasce com o visual do Discord.
            btn.className = `${site.style.className} p2ps-voice-btn`;
            btn.type = "button";
            btn.innerHTML = SCREENSHARE_SVG;
            btn.addEventListener("click", e => {
                e.preventDefault();
                e.stopPropagation();
                opts.onToggle(btn);
            });

            site.place(btn);
            paintOne(btn);
            voiceBtns.set(site.host, btn);
        }

        // Achar onde injetar nao basta: um botao invisivel deixaria o usuario
        // sem forma de transmitir, e o flutuante ja teria sido escondido.
        opts.onAnchorChange([...voiceBtns.values()].some(isVisible));
        // A lista e a grade re-renderizam sozinhas; os selos precisam voltar.
        applyLiveBadges();
        applyTileBadges();
        applyTileVideos();
        dumpVoiceDiagnostics();
    };

    sync();

    // O Discord muta o DOM o tempo todo: junta tudo num sync por quadro.
    let queued = false;
    const schedule = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            sync();
        });
    };

    voiceObserver = new MutationObserver(schedule);
    voiceObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
        voiceObserver?.disconnect();
        voiceObserver = null;
        for (const btn of voiceBtns.values()) removeBtn(btn);
        voiceBtns.clear();
    };
}

let lastDumpKey = "";

/** Fotografa o estado da injecao num arquivo, ja que o DevTools vive desligado. */
export function dumpVoiceDiagnostics(): void {
    try {
        const sites = collectSites();
        const key = sites.map(s => s.host.className).join("|") + "#" + voiceBtns.size;
        if (key === lastDumpKey) return;
        lastDumpKey = key;

        const data = {
            quando: new Date().toISOString(),
            pontosEncontrados: sites.length,
            injetados: [...voiceBtns.values()].map(b => {
                const r = b.getBoundingClientRect();
                return {
                    visivel: isVisible(b),
                    tamanho: `${Math.round(r.width)}x${Math.round(r.height)}`,
                    pos: `${Math.round(r.x)},${Math.round(r.y)}`
                };
            }),
            flutuante: launcher
                ? (launcher.classList.contains("p2ps-launcher-hidden") ? "escondido" : "visivel")
                : "nao montado"
        };

        const fs = require("fs");
        const path = require("path");
        fs.writeFileSync(
            path.join(BdApi.Plugins.folder, "p2pshare-debug.json"),
            JSON.stringify(data, null, 2),
            "utf8"
        );
    } catch (err) {
        console.warn("[P2PShare] não deu para gravar o diagnóstico", err);
    }
}

export function updateVoiceButton(state: { active: boolean; viewers: number; }): void {
    lastState = state;
    for (const btn of voiceBtns.values()) paintOne(btn);
}


// ------------------------------------------------- selo AO VIVO na lista

export interface LiveUser {
    id: string;
    /** Nome de exibicao e username: o painel pode mostrar qualquer um dos dois. */
    names: string[];
    /** Ausente quando sou eu transmitindo: nao ha o que assistir. */
    onWatch?: () => void;
}

let liveUsers: LiveUser[] = [];

/**
 * Marca quem esta transmitindo na lista de participantes do canal.
 *
 * Casa por id sempre que da': o avatar do Discord traz o id do usuario na
 * URL. Nome fica como reserva, porque quem usa avatar padrao nao tem id na
 * imagem — e nome de exibicao pode divergir do username.
 */
function applyLiveBadges(): void {
    for (const row of document.querySelectorAll<HTMLElement>('[class*="voiceUser"]')) {
        const nameEl = row.querySelector<HTMLElement>('[class*="username__"]');
        const text = nameEl?.textContent?.trim();

        const avatar = row.querySelector<HTMLElement>('[class*="userAvatar"]');
        const id = (avatar?.style.backgroundImage || "").match(/avatars\/(\d+)\//)?.[1];

        const live = liveUsers.some(u =>
            (id && u.id === id) || (!!text && u.names.includes(text)));

        const existing = row.querySelector(".p2ps-live-chip");

        if (!live) {
            existing?.remove();
            continue;
        }
        if (existing) continue;

        const user = liveUsers.find(u =>
            (id && u.id === id) || (!!text && u.names.includes(text)));

        const chip = document.createElement("span");
        chip.className = "p2ps-live-chip";
        chip.textContent = "AO VIVO";

        if (user?.onWatch) {
            chip.classList.add("p2ps-clickable");
            chip.title = "Clique para assistir";
            chip.addEventListener("click", e => {
                e.preventDefault();
                e.stopPropagation();
                user.onWatch!();
            });
        } else {
            chip.title = "Transmitindo via P2PShare";
        }

        // Ao lado do nome, na mesma linha. O chipletParent parece o lugar
        // obvio, mas e' um bloco proprio com espacamento e mascara, e o selo
        // sai desalinhado dali.
        const slot = row.querySelector('[class*="usernameContainer"]')
            ?? row.querySelector('[class*="chipletParent"]')
            ?? nameEl?.parentElement;
        slot?.appendChild(chip);
    }
}

/**
 * Marca o quadro de video da pessoa na grade da chamada.
 *
 * O Discord identifica cada quadro com data-selenium-video-tile = id do
 * usuario, o que dispensa casar por nome. O selo entra no overlay de cima,
 * que o Discord deixa reservado e vazio, e e' clicavel: quem ve o quadro
 * escuro do amigo tem ali o caminho mais curto para abrir a transmissao.
 */
function applyTileBadges(): void {
    for (const tile of document.querySelectorAll<HTMLElement>("[data-selenium-video-tile]")) {
        const id = tile.getAttribute("data-selenium-video-tile");
        const user = liveUsers.find(u => u.id === id);
        const existing = tile.querySelector(".p2ps-tile-live");

        if (!user) {
            existing?.remove();
            tile.querySelector(".p2ps-tile-cta")?.remove();
            continue;
        }

        // Ja assistindo: o botao sai, o video ocupa o quadro.
        if (!user.onWatch) tile.querySelector(".p2ps-tile-cta")?.remove();
        if (existing) continue;

        const badge = document.createElement("span");
        badge.className = "p2ps-tile-live";
        badge.textContent = "AO VIVO";
        badge.title = user.onWatch
            ? "Transmitindo via P2PShare"
            : "Você está transmitindo via P2PShare";

        // O overlay de cima e' o lugar que o Discord reserva para isto.
        const slot = tile.querySelector('[class*="overlayTop"]')
            ?? tile.querySelector('[class*="tileChild"]')
            ?? tile;
        slot.appendChild(badge);

        // O selo do canto informa; quem age e' o botao no meio do quadro, que
        // e' onde o olho vai parar num quadro sem video.
        if (!user.onWatch) continue;

        const child = tile.querySelector<HTMLElement>('[class*="tileChild"]') ?? tile;
        if (child.querySelector(".p2ps-tile-cta")) continue;

        const cta = document.createElement("button");
        cta.type = "button";
        cta.className = "p2ps-tile-cta";
        cta.innerHTML = '<span class="p2ps-cta-play">▶</span> Assistir transmissão';
        cta.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            user.onWatch!();
        });

        child.appendChild(cta);
    }
}

/**
 * Leva a tela ate' o canal de voz indicado.
 *
 * Clicar em AO VIVO de dentro da lista lateral so' e' util se a pessoa passar
 * a ver a chamada — senao o video seria pintado num quadro fora de vista.
 * O proprio Discord marca cada canal com data-list-item-id.
 */
export function focusChannel(channelId: string): void {
    const safe = channelId.replace(/[^\w-]/g, "");
    if (!safe) return;

    const link = document.querySelector<HTMLElement>(
        `[data-list-item-id="channels___${safe}"]`);

    link?.click();
}

export function setLiveUsers(users: LiveUser[]): void {
    liveUsers = users;
    applyLiveBadges();
    applyTileBadges();
}


// ------------------------------------------------------- menu da transmissao

export interface QualityChoice {
    maxHeight: number | null;
    maxFramerate: number | null;
}

const RESOLUTIONS: { label: string; value: number | null; }[] = [
    { label: "Original", value: null },
    { label: "1440p", value: 1440 },
    { label: "1080p", value: 1080 },
    { label: "720p", value: 720 },
    { label: "480p", value: 480 }
];

const FRAMERATES: { label: string; value: number | null; }[] = [
    { label: "Máximo", value: null },
    { label: "60 fps", value: 60 },
    { label: "30 fps", value: 30 },
    { label: "15 fps", value: 15 }
];

let openMenu: HTMLElement | null = null;

export function closeBroadcastMenu(): void {
    openMenu?.remove();
    openMenu = null;
}

/**
 * Menu do botao enquanto a transmissao esta no ar.
 *
 * Enquanto transmite, o clique deixa de ser liga/desliga: e' daqui que se
 * ajusta qualidade e se encerra. As opcoes valem na hora, sem recapturar.
 */
export function openBroadcastMenu(anchor: HTMLElement, opts: {
    quality: QualityChoice;
    onQuality: (quality: QualityChoice) => void;
    onStop: () => void;
}): void {
    closeBroadcastMenu();

    const menu = document.createElement("div");
    menu.className = "p2ps-menu";

    const current = { ...opts.quality };

    const addSubmenu = (
        title: string,
        options: { label: string; value: number | null; }[],
        selected: () => number | null,
        apply: (value: number | null) => void
    ) => {
        const item = document.createElement("div");
        item.className = "p2ps-menu-item p2ps-menu-parent";

        const label = document.createElement("span");
        label.textContent = title;

        const value = document.createElement("span");
        value.className = "p2ps-menu-value";
        const paintValue = () => {
            value.textContent =
                (options.find(o => o.value === selected())?.label ?? "—") + "  ›";
        };
        paintValue();

        item.append(label, value);

        const sub = document.createElement("div");
        sub.className = "p2ps-submenu";

        for (const option of options) {
            const row = document.createElement("div");
            row.className = "p2ps-menu-item";
            row.textContent = option.label;

            const check = document.createElement("span");
            check.className = "p2ps-menu-check";
            check.textContent = option.value === selected() ? "✓" : "";
            row.appendChild(check);

            row.addEventListener("click", e => {
                e.stopPropagation();
                apply(option.value);
                paintValue();
                for (const other of sub.querySelectorAll(".p2ps-menu-check")) {
                    other.textContent = "";
                }
                check.textContent = "✓";
                opts.onQuality(current);
            });

            sub.appendChild(row);
        }

        item.appendChild(sub);
        menu.appendChild(item);
    };

    addSubmenu("Resolução", RESOLUTIONS,
        () => current.maxHeight,
        v => { current.maxHeight = v; });

    addSubmenu("Taxa de quadros", FRAMERATES,
        () => current.maxFramerate,
        v => { current.maxFramerate = v; });

    const sep = document.createElement("div");
    sep.className = "p2ps-menu-sep";
    menu.appendChild(sep);

    const stop = document.createElement("div");
    stop.className = "p2ps-menu-item p2ps-menu-danger";
    stop.textContent = "Parar de transmitir";
    stop.addEventListener("click", e => {
        e.stopPropagation();
        closeBroadcastMenu();
        opts.onStop();
    });
    menu.appendChild(stop);

    document.body.appendChild(menu);
    openMenu = menu;

    // Acima do botao, preso a' tela: a barra vive no rodape da chamada.
    const rect = anchor.getBoundingClientRect();
    const box = menu.getBoundingClientRect();
    const left = Math.min(
        Math.max(8, rect.left + rect.width / 2 - box.width / 2),
        window.innerWidth - box.width - 8
    );
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, rect.top - box.height - 8)}px`;

    const onOutside = (e: MouseEvent) => {
        if (!menu.contains(e.target as Node)) {
            closeBroadcastMenu();
            cleanup();
        }
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            closeBroadcastMenu();
            cleanup();
        }
    };
    const cleanup = () => {
        document.removeEventListener("mousedown", onOutside, true);
        document.removeEventListener("keydown", onKey, true);
    };

    // Adiado um tique: o clique que abriu o menu ainda esta borbulhando.
    setTimeout(() => {
        document.addEventListener("mousedown", onOutside, true);
        document.addEventListener("keydown", onKey, true);
    }, 0);
}

// ------------------------------------------------------------ source picker

function thumbnailOf(source: CaptureSource): string | null {
    const raw = source as unknown as Record<string, unknown>;

    for (const key of ["thumbnail", "url", "image"]) {
        const value = raw[key];
        if (typeof value === "string" && value.startsWith("data:")) return value;
        if (value && typeof (value as any).toDataURL === "function") {
            try {
                return (value as any).toDataURL();
            } catch {
                // formato inesperado: tenta a próxima chave
            }
        }
    }

    return null;
}

const isScreen = (s: CaptureSource) => s.id.startsWith("screen:");

export function openSourcePicker(sources: CaptureSource[]): Promise<CaptureChoice | null> {
    return new Promise(resolve => {
        let selected: string | null = null;
        let tab: "screen" | "window" = sources.some(isScreen) ? "screen" : "window";

        const backdrop = document.createElement("div");
        backdrop.className = "p2ps-backdrop";
        backdrop.innerHTML = `
            <div class="p2ps-dialog">
                <div class="p2ps-dialog-head">Compartilhar via P2P</div>
                <div class="p2ps-dialog-body">
                    <div class="p2ps-tabs">
                        <button class="p2ps-tab" data-tab="screen">Tela inteira</button>
                        <button class="p2ps-tab" data-tab="window">Aplicativos</button>
                    </div>
                    <div class="p2ps-grid"></div>
                </div>
                <div class="p2ps-dialog-foot">
                    <label class="p2ps-audio-toggle">
                        <input type="checkbox" data-act="audio">
                        <span data-act="audio-label"></span>
                    </label>
                    <span class="p2ps-foot-space"></span>
                    <button class="p2ps-btn p2ps-btn-secondary" data-act="cancel">Cancelar</button>
                    <button class="p2ps-btn" data-act="ok" disabled>Transmitir</button>
                </div>
            </div>`;

        const grid = backdrop.querySelector(".p2ps-grid") as HTMLElement;
        const okBtn = backdrop.querySelector('[data-act="ok"]') as HTMLButtonElement;

        const audioCheck = backdrop.querySelector('[data-act="audio"]') as HTMLInputElement;
        const audioLabel = backdrop.querySelector('[data-act="audio-label"]') as HTMLElement;

        // Sem o componente, o único áudio possível seria o do sistema — que
        // devolve a própria chamada para quem assiste. Melhor ir sem áudio.
        const audioAvailable = helperReady() && !nativeAudioBlocked();

        audioCheck.disabled = !audioAvailable;
        audioCheck.checked = audioAvailable && BdApi.Data.load("P2PShare", "captureAudio") !== false;
        audioLabel.textContent = audioAvailable
            ? "Transmitir áudio"
            : "Áudio indisponível — componente ainda não instalado";
        audioCheck.addEventListener("change", () =>
            BdApi.Data.save("P2PShare", "captureAudio", audioCheck.checked));

        let settled = false;
        const settle = (id: string | null) => {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onKey);
            backdrop.remove();
            resolve(id ? { id, audio: audioCheck.checked } : null);
        };

        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") settle(null); };

        const render = () => {
            for (const btn of backdrop.querySelectorAll<HTMLElement>(".p2ps-tab")) {
                btn.classList.toggle("p2ps-tab-active", btn.dataset.tab === tab);
            }

            grid.innerHTML = "";
            const shown = sources.filter(s => (tab === "screen" ? isScreen(s) : !isScreen(s)));

            if (!shown.length) {
                grid.textContent = "Nenhuma fonte encontrada nesta aba.";
                return;
            }

            for (const source of shown) {
                const thumb = thumbnailOf(source);
                const card = document.createElement("div");
                card.className = "p2ps-card" + (selected === source.id ? " p2ps-card-selected" : "");

                const thumbEl = document.createElement("div");
                thumbEl.className = "p2ps-card-thumb";
                if (thumb) {
                    const img = document.createElement("img");
                    img.src = thumb;
                    thumbEl.appendChild(img);
                } else {
                    thumbEl.textContent = "sem prévia";
                }

                const nameEl = document.createElement("div");
                nameEl.className = "p2ps-card-name";
                nameEl.textContent = source.name;
                nameEl.title = source.name;

                card.append(thumbEl, nameEl);
                card.addEventListener("click", () => {
                    selected = source.id;
                    okBtn.disabled = false;
                    render();
                });
                card.addEventListener("dblclick", () => settle(source.id));

                grid.appendChild(card);
            }
        };

        for (const btn of backdrop.querySelectorAll<HTMLElement>(".p2ps-tab")) {
            btn.addEventListener("click", () => {
                tab = btn.dataset.tab as "screen" | "window";
                selected = null;
                okBtn.disabled = true;
                render();
            });
        }

        okBtn.addEventListener("click", () => settle(selected));
        backdrop.querySelector('[data-act="cancel"]')!.addEventListener("click", () => settle(null));
        backdrop.addEventListener("click", e => { if (e.target === backdrop) settle(null); });
        document.addEventListener("keydown", onKey);

        render();
        document.body.appendChild(backdrop);
    });
}

// ---------------------------------------------------------------- overlays

const overlays = new Map<string, HTMLElement>();


// --------------------------------------------- video dentro do quadro

interface TileSession {
    userId: string;
    stream: MediaStream;
    title: string;
    muted: boolean;
    /** Falso na prévia da própria tela: não há o que "parar de assistir". */
    closable: boolean;
    onClose: () => void;
    /** Toca o som uma vez so', fora dos quadros. */
    audio: HTMLAudioElement | null;
    volume: number;
}

const tileSessions = new Map<string, TileSession>();
/** Sessoes que estao em janela solta, mas cujo quadro ainda existe. */
const poppedOut = new Map<string, TileSession>();

function tilesOf(userId: string): HTMLElement[] {
    // Id do Discord é numérico; limpar o resto evita montar um seletor inválido.
    const safe = userId.replace(/[^\w-]/g, "");
    if (!safe) return [];

    return [...document.querySelectorAll<HTMLElement>(
        `[data-selenium-video-tile="${safe}"]`)];
}

function buildTileBar(sessionId: string, session: TileSession): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "p2ps-tile-bar";

    const mkBtn = (text: string, title: string, onClick: () => void) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.title = title;
        b.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });
        return b;
    };

    if (!session.muted) {
        const vol = document.createElement("input");
        vol.type = "range";
        vol.min = "0";
        vol.max = "100";
        vol.value = String(Math.round(session.volume * 100));
        vol.className = "p2ps-tile-vol";
        vol.title = "Volume";
        // Sem isto o clique atravessa e o Discord troca o foco do quadro.
        vol.addEventListener("mousedown", e => e.stopPropagation());
        vol.addEventListener("click", e => e.stopPropagation());
        vol.addEventListener("input", () => {
            session.volume = Number(vol.value) / 100;
            if (session.audio) session.audio.volume = session.volume;
        });
        bar.appendChild(vol);
    }

    bar.appendChild(mkBtn("⛶", "Tela cheia", () => {
        const video = bar.parentElement?.querySelector("video");
        void (video as HTMLVideoElement | null)?.requestFullscreen();
    }));

    bar.appendChild(mkBtn("⧉", "Abrir em janela solta", () => popOut(sessionId)));

    if (session.closable) {
        bar.appendChild(mkBtn("✕", `Parar de assistir ${session.title}`, session.onClose));
    }

    return bar;
}

/**
 * Pinta o stream por cima do avatar, no quadro da propria pessoa.
 *
 * A mesma pessoa aparece em mais de um quadro (o grande em foco e o da tira
 * de baixo). Todos recebem o video, mas mudos: o som sai de um elemento de
 * audio unico, senao tocaria duplicado.
 */
function applyTileVideos(): void {
    const claimed = new Set<HTMLElement>();

    for (const [sessionId, session] of tileSessions) {
        for (const tile of tilesOf(session.userId)) {
            const child = tile.querySelector<HTMLElement>('[class*="tileChild"]') ?? tile;
            claimed.add(child);

            if (child.querySelector(".p2ps-tile-video")) continue;

            const video = document.createElement("video");
            video.className = "p2ps-tile-video";
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true;
            video.srcObject = session.stream;

            child.appendChild(video);
            child.appendChild(buildTileBar(sessionId, session));
        }
    }

    // Quadro que deixou de ter sessao: limpa o que sobrou.
    for (const el of document.querySelectorAll<HTMLElement>(".p2ps-tile-video")) {
        const child = el.parentElement;
        if (child && !claimed.has(child)) {
            el.remove();
            child.querySelector(".p2ps-tile-bar")?.remove();
        }
    }
}

/**
 * Tira do quadro e abre em janela solta, guardando a sessao para poder voltar.
 *
 * Fechar a janela devolve ao quadro em vez de encerrar: quem soltou queria
 * mover a transmissao, nao parar de assistir. Parar continua sendo o ✕ do
 * quadro, e a janela ganha um ⏹ para quem preferir encerrar dali.
 */
function popOut(sessionId: string): void {
    const session = tileSessions.get(sessionId);
    if (!session) return;

    detachFromTiles(sessionId, { keepAudio: true });
    poppedOut.set(sessionId, session);

    mountFloatingOverlay(sessionId, session.stream, session.title, session.onClose, {
        muted: session.muted,
        onDock: () => dockBack(sessionId)
    });
}

function dockBack(sessionId: string): void {
    const session = poppedOut.get(sessionId);
    if (!session) return;

    poppedOut.delete(sessionId);
    unmountFloatingOverlay(sessionId);

    tileSessions.set(sessionId, session);
    applyTileVideos();
}

function detachFromTiles(sessionId: string, opts: { keepAudio?: boolean; } = {}): void {
    const session = tileSessions.get(sessionId);
    if (!session) return;

    tileSessions.delete(sessionId);

    for (const tile of tilesOf(session.userId)) {
        tile.querySelector(".p2ps-tile-video")?.remove();
        tile.querySelector(".p2ps-tile-bar")?.remove();
    }

    // Soltar em janela nao interrompe o som; encerrar de vez, sim.
    if (!opts.keepAudio) {
        session.audio?.pause();
        session.audio?.remove();
        session.audio = null;
    }
}


function mountFloatingOverlay(
    sessionId: string,
    stream: MediaStream,
    title: string,
    onClose: () => void,
    opts: { muted?: boolean; closeLabel?: string; onDock?: () => void; } = {}
): void {
    unmountFloatingOverlay(sessionId);

    const el = document.createElement("div");
    el.className = "p2ps-overlay";
    el.style.left = "80px";
    el.style.top = "80px";
    el.style.width = "640px";

    // Controles proprios em vez do player nativo: para um MediaStream ao vivo
    // o player do Chrome desenha uma linha do tempo com duracao, o que faz a
    // transmissao parecer um video gravado.
    el.innerHTML = `
        <div class="p2ps-overlay-bar">
            <span class="p2ps-live"><span class="p2ps-live-dot"></span>AO VIVO</span>
            <span class="p2ps-overlay-title"></span>
            <button data-act="mute" title="Silenciar"></button>
            <input class="p2ps-vol" type="range" min="0" max="100" value="100" title="Volume">
            <button data-act="full" title="Tela cheia">⛶</button>
            <button data-act="close">✕</button>
        </div>
        <video autoplay playsinline></video>
        <div class="p2ps-viewers" hidden></div>`;

    (el.querySelector(".p2ps-overlay-title") as HTMLElement).textContent = title;

    const video = el.querySelector("video") as HTMLVideoElement;
    video.srcObject = stream;
    video.muted = opts.muted === true;

    const muteBtn = el.querySelector('[data-act="mute"]') as HTMLButtonElement;
    const vol = el.querySelector(".p2ps-vol") as HTMLInputElement;

    const paintAudio = () => {
        muteBtn.textContent = video.muted || video.volume === 0 ? "🔇" : "🔊";
    };

    if (opts.muted) {
        // Na propria previa nao ha o que ouvir: o audio sai pelos alto-falantes.
        muteBtn.disabled = true;
        vol.disabled = true;
        muteBtn.title = "A previa da sua tela fica sempre muda";
    } else {
        muteBtn.addEventListener("click", () => {
            video.muted = !video.muted;
            paintAudio();
        });
        vol.addEventListener("input", () => {
            video.volume = Number(vol.value) / 100;
            video.muted = video.volume === 0;
            paintAudio();
        });
    }

    paintAudio();

    el.querySelector('[data-act="full"]')!.addEventListener("click", () => {
        void video.requestFullscreen();
    });
    const closeBtn = el.querySelector('[data-act="close"]') as HTMLButtonElement;

    if (opts.onDock) {
        // Fechar devolve ao quadro; encerrar de vez fica num botao proprio.
        closeBtn.title = "Voltar para o quadro";
        closeBtn.addEventListener("click", opts.onDock);

        const stop = document.createElement("button");
        stop.type = "button";
        stop.textContent = "⏹";
        stop.title = `Parar de assistir ${title}`;
        stop.addEventListener("click", onClose);
        closeBtn.insertAdjacentElement("beforebegin", stop);
    } else {
        closeBtn.title = opts.closeLabel ?? "Fechar";
        closeBtn.addEventListener("click", onClose);
    }

    makeDraggable(el, el.querySelector(".p2ps-overlay-bar") as HTMLElement);

    document.body.appendChild(el);
    overlays.set(sessionId, el);
}

/**
 * Preenche a faixa de espectadores da janela do emissor.
 *
 * Fica escondida ate' existir alguem: uma faixa vazia so' rouba espaco da
 * previa, e "0 assistindo" nao diz nada que o silencio ja nao diga.
 */
export function setOverlayViewers(sessionId: string, names: string[]): void {
    const el = overlays.get(sessionId);
    if (!el) return;

    const bar = el.querySelector(".p2ps-viewers") as HTMLElement | null;
    if (!bar) return;

    if (!names.length) {
        bar.hidden = true;
        bar.textContent = "";
        return;
    }

    bar.hidden = false;
    bar.textContent = "";

    const label = document.createElement("span");
    label.className = "p2ps-viewers-label";
    label.textContent = names.length === 1 ? "Assistindo" : `Assistindo (${names.length})`;
    bar.appendChild(label);

    for (const name of names) {
        const chip = document.createElement("span");
        chip.className = "p2ps-viewer-chip";
        chip.textContent = name;
        bar.appendChild(chip);
    }
}

/**
 * Mostra a transmissão. Prefere o quadro da pessoa na grade da chamada, que é
 * onde quem assiste já está olhando; cai para a janela flutuante quando não há
 * quadro — fora de chamada, ou antes da grade renderizar.
 */
export function mountOverlay(
    sessionId: string,
    stream: MediaStream,
    title: string,
    onClose: () => void,
    opts: {
        muted?: boolean;
        closeLabel?: string;
        userId?: string;
        closable?: boolean;
    } = {}
): void {
    unmountOverlay(sessionId);

    if (opts.userId && tilesOf(opts.userId).length) {
        const session: TileSession = {
            userId: opts.userId,
            stream,
            title,
            muted: opts.muted === true,
            closable: opts.closable !== false,
            onClose,
            audio: null,
            volume: 1
        };

        if (!session.muted) {
            // Um elemento só para o som: os quadros ficam mudos para não
            // tocar duplicado quando a pessoa aparece em dois lugares.
            const audio = document.createElement("audio");
            audio.autoplay = true;
            audio.srcObject = stream;
            audio.style.display = "none";
            document.body.appendChild(audio);
            session.audio = audio;
        }

        tileSessions.set(sessionId, session);
        applyTileVideos();
        return;
    }

    mountFloatingOverlay(sessionId, stream, title, onClose, opts);
}

function unmountFloatingOverlay(sessionId: string): void {
    const el = overlays.get(sessionId);
    if (!el) return;

    (el as any).__p2psCleanupDrag?.();
    const video = el.querySelector("video");
    if (video) video.srcObject = null;

    el.remove();
    overlays.delete(sessionId);
}

export function unmountOverlay(sessionId: string): void {
    detachFromTiles(sessionId);
    poppedOut.delete(sessionId);

    const el = overlays.get(sessionId);
    if (!el) return;

    (el as any).__p2psCleanupDrag?.();
    const video = el.querySelector("video");
    if (video) video.srcObject = null;

    el.remove();
    overlays.delete(sessionId);
}

export function unmountAllOverlays(): void {
    for (const sessionId of [...tileSessions.keys()]) unmountOverlay(sessionId);
    for (const sessionId of [...poppedOut.keys()]) unmountOverlay(sessionId);
    for (const sessionId of [...overlays.keys()]) unmountOverlay(sessionId);
}

// ----------------------------------------------------------------- notices

const notices = new Map<string, () => void>();

export function announceBeacon(
    notice: { sessionId: string; broadcasterName: string; },
    onWatch: () => void
): void {
    revokeBeacon(notice.sessionId);

    const close = BdApi.UI.showNotice(
        `${notice.broadcasterName} está transmitindo a tela via P2P.`,
        {
            type: "info",
            buttons: [{
                label: "Assistir",
                onClick: () => {
                    onWatch();
                    revokeBeacon(notice.sessionId);
                }
            }]
        }
    );

    notices.set(notice.sessionId, close);
}

export function revokeBeacon(sessionId: string): void {
    const close = notices.get(sessionId);
    if (!close) return;

    notices.delete(sessionId);
    try {
        close();
    } catch {
        // o aviso já pode ter sido fechado pelo usuário
    }
}
