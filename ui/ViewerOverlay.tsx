/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./overlay.css";

import { createRoot, React, useEffect, useRef, useState } from "@webpack/common";

import { settings } from "../settings";

interface OverlayProps {
    stream: MediaStream;
    title: string;
    onClose: () => void;
    muted: boolean;
    closeLabel?: string;
    viewers: string[];
}

function ViewerOverlay({ stream, title, onClose, muted, closeLabel, viewers }: OverlayProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x: settings.store.overlayX, y: settings.store.overlayY });
    const drag = useRef<{ dx: number; dy: number; } | null>(null);

    useEffect(() => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        videoRef.current.muted = muted;
    }, [stream, muted]);

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!drag.current) return;
            setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
        };

        const onUp = () => {
            if (drag.current) {
                drag.current = null;
                settings.store.overlayX = pos.x;
                settings.store.overlayY = pos.y;
            }

            // O resize nativo do CSS não emite evento: lê a largura ao soltar.
            const width = boxRef.current?.offsetWidth;
            if (width && width !== settings.store.overlayWidth) {
                settings.store.overlayWidth = width;
            }
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
    }, [pos]);

    const startDrag = (e: React.MouseEvent) => {
        drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    };

    return (
        <div
            ref={boxRef}
            className="p2ps-overlay"
            style={{ left: pos.x, top: pos.y, width: settings.store.overlayWidth }}
        >
            <div className="p2ps-overlay-bar" onMouseDown={startDrag}>
                <span className="p2ps-live"><span className="p2ps-live-dot" />AO VIVO</span>
                <span className="p2ps-overlay-title">{title}</span>
                {!muted && (
                    <input
                        className="p2ps-vol"
                        type="range"
                        min={0}
                        max={100}
                        defaultValue={100}
                        title="Volume"
                        onMouseDown={e => e.stopPropagation()}
                        onInput={e => {
                            const v = Number((e.target as HTMLInputElement).value) / 100;
                            if (videoRef.current) {
                                videoRef.current.volume = v;
                                videoRef.current.muted = v === 0;
                            }
                        }}
                    />
                )}
                <button onClick={() => void videoRef.current?.requestFullscreen()} title="Tela cheia">⛶</button>
                <button onClick={onClose} title={closeLabel ?? "Fechar"}>✕</button>
            </div>
            {/* Sem `controls`: para um stream ao vivo o player nativo desenha
                uma linha do tempo, e a transmissao parece video gravado. */}
            <video ref={videoRef} autoPlay playsInline />
            {viewers.length > 0 && (
                <div className="p2ps-viewers">
                    <span className="p2ps-viewers-label">
                        {viewers.length === 1 ? "Assistindo" : `Assistindo (${viewers.length})`}
                    </span>
                    {viewers.map(name => (
                        <span className="p2ps-viewer-chip" key={name}>{name}</span>
                    ))}
                </div>
            )}
        </div>
    );
}

interface MountedOverlay {
    root: ReturnType<typeof createRoot>;
    container: HTMLElement;
    viewers: string[];
    render: () => void;
}

const mounted = new Map<string, MountedOverlay>();

export function mountOverlay(
    sessionId: string,
    stream: MediaStream,
    title: string,
    onClose: () => void,
    // userId só serve ao BetterDiscord, que pinta o vídeo no quadro da
    // pessoa; aqui a janela flutuante é o único formato.
    opts: { muted?: boolean; closeLabel?: string; userId?: string; closable?: boolean; } = {}
): void {
    unmountOverlay(sessionId);

    const container = document.createElement("div");
    container.id = `p2ps-overlay-${sessionId}`;
    document.body.appendChild(container);

    const root = createRoot(container);

    const entry: MountedOverlay = {
        root,
        container,
        viewers: [],
        render: () => root.render(
            <ViewerOverlay
                stream={stream}
                title={title}
                onClose={onClose}
                muted={opts.muted === true}
                closeLabel={opts.closeLabel}
                viewers={entry.viewers}
            />
        )
    };

    mounted.set(sessionId, entry);
    entry.render();
}

/**
 * Lista quem está assistindo, na janela de prévia do emissor.
 * Sem espectadores a faixa some: "0 assistindo" não diz nada.
 */
export function setOverlayViewers(sessionId: string, names: string[]): void {
    const entry = mounted.get(sessionId);
    if (!entry) return;

    entry.viewers = names;
    entry.render();
}

export function unmountOverlay(sessionId: string): void {
    const entry = mounted.get(sessionId);
    if (!entry) return;

    mounted.delete(sessionId);
    // unmount síncrono dentro de um render do React explode; adia um tick.
    setTimeout(() => {
        entry.root.unmount();
        entry.container.remove();
    }, 0);
}

export function unmountAllOverlays(): void {
    for (const sessionId of [...mounted.keys()]) unmountOverlay(sessionId);
}
