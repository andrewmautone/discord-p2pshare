/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { CaptureSource } from "../../capture";

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
    BdApi.DOM.removeStyle("P2PShare");
}

/** Deixa um elemento arrastável pela alça informada. */
function makeDraggable(el: HTMLElement, handle: HTMLElement, onDrop?: () => void): void {
    let offset: { x: number; y: number; } | null = null;

    handle.addEventListener("mousedown", e => {
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
    onToggle: () => void;
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
    el.addEventListener("click", () => { if (!moved) opts.onToggle(); });

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

let voiceBtn: HTMLElement | null = null;
let voiceObserver: MutationObserver | null = null;
let lastState = { active: false, viewers: 0 };

/**
 * Acha o botao nativo de compartilhar tela no painel de voz.
 *
 * Estrategias em ordem de robustez. Nomes de classe do Discord sao hashes que
 * mudam a cada build, e aria-label muda com o idioma — o desenho do icone e' o
 * que sobrevive mais tempo, entao ele vem primeiro.
 */
function findShareButton(): HTMLElement | null {
    // O botao que injetamos usa o mesmo icone e um rotulo com "tela": sem esta
    // exclusao ele viraria ancora de si mesmo a cada re-render.
    const isOurs = (el: Element | null) => !!el?.classList.contains("p2ps-voice-btn");

    // 1. pelo path do icone de compartilhar tela
    for (const path of document.querySelectorAll('button svg path[d^="M2 4.5C2 3.397"]')) {
        const btn = path.closest("button");
        if (btn && !isOurs(btn)) return btn as HTMLElement;
    }

    // 2. pelo rotulo de acessibilidade, cobrindo pt e en
    for (const btn of document.querySelectorAll<HTMLElement>("button[aria-label]")) {
        if (isOurs(btn)) continue;

        const label = (btn.getAttribute("aria-label") || "").toLowerCase();
        if (label.includes("tela") || label.includes("screen") || label.includes("share")) {
            return btn;
        }
    }

    return null;
}

function paintVoiceButton(): void {
    if (!voiceBtn) return;

    const svg = voiceBtn.querySelector("svg") as SVGElement | null;
    if (svg) {
        svg.style.color = lastState.active ? "var(--status-danger, #ed4245)" : "";
    }

    voiceBtn.setAttribute(
        "aria-label",
        lastState.active
            ? `Parar transmissão P2P — ${lastState.viewers} assistindo`
            : "Transmitir tela via P2P"
    );
    voiceBtn.title = voiceBtn.getAttribute("aria-label") || "";

    voiceBtn.querySelector(".p2ps-voice-count")?.remove();
    if (lastState.active && lastState.viewers > 0) {
        const badge = document.createElement("span");
        badge.className = "p2ps-voice-count";
        badge.textContent = String(lastState.viewers);
        voiceBtn.appendChild(badge);
    }
}

/**
 * Injeta um botao P2P ao lado do botao nativo de tela.
 *
 * `onAnchorChange` avisa se o botao nativo existe: quem chama usa isso para
 * mostrar o botao flutuante como reserva quando o Discord mudar o HTML e a
 * injecao parar de funcionar.
 */
export function mountVoiceButton(opts: {
    onToggle: () => void;
    onAnchorChange: (found: boolean) => void;
}): () => void {
    const sync = () => {
        const anchor = findShareButton();

        if (!anchor) {
            voiceBtn?.remove();
            voiceBtn = null;
            opts.onAnchorChange(false);
            return;
        }

        // Ja injetado e ainda no lugar certo: nada a fazer.
        if (voiceBtn && voiceBtn.isConnected && voiceBtn.previousElementSibling === anchor) {
            opts.onAnchorChange(true);
            return;
        }

        voiceBtn?.remove();

        const btn = document.createElement("button");
        // Herda as classes do vizinho: assim ele ja nasce com o visual do
        // Discord, sem a gente adivinhar tamanho, cor e estados de hover.
        btn.className = `${anchor.className} p2ps-voice-btn`;
        btn.type = "button";
        btn.innerHTML = SCREENSHARE_SVG;
        btn.addEventListener("click", e => {
            e.preventDefault();
            e.stopPropagation();
            opts.onToggle();
        });

        anchor.insertAdjacentElement("afterend", btn);
        voiceBtn = btn;
        paintVoiceButton();
        opts.onAnchorChange(true);
    };

    sync();

    // O Discord muta o DOM o tempo todo; rodar querySelector a cada mutacao
    // custaria caro. Junta tudo num sync por quadro.
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
        voiceBtn?.remove();
        voiceBtn = null;
    };
}

export function updateVoiceButton(state: { active: boolean; viewers: number; }): void {
    lastState = state;
    paintVoiceButton();
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

export function openSourcePicker(sources: CaptureSource[]): Promise<string | null> {
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
                    <button class="p2ps-btn p2ps-btn-secondary" data-act="cancel">Cancelar</button>
                    <button class="p2ps-btn" data-act="ok" disabled>Transmitir</button>
                </div>
            </div>`;

        const grid = backdrop.querySelector(".p2ps-grid") as HTMLElement;
        const okBtn = backdrop.querySelector('[data-act="ok"]') as HTMLButtonElement;

        let settled = false;
        const settle = (id: string | null) => {
            if (settled) return;
            settled = true;
            document.removeEventListener("keydown", onKey);
            backdrop.remove();
            resolve(id);
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

export function mountOverlay(
    sessionId: string,
    stream: MediaStream,
    title: string,
    onClose: () => void,
    opts: { muted?: boolean; closeLabel?: string; } = {}
): void {
    unmountOverlay(sessionId);

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
    closeBtn.title = opts.closeLabel ?? "Fechar";
    closeBtn.addEventListener("click", onClose);

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

export function unmountOverlay(sessionId: string): void {
    const el = overlays.get(sessionId);
    if (!el) return;

    (el as any).__p2psCleanupDrag?.();
    const video = el.querySelector("video");
    if (video) video.srcObject = null;

    el.remove();
    overlays.delete(sessionId);
}

export function unmountAllOverlays(): void {
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
