/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./overlay.css";

import { createRoot, React, useEffect, useRef, useState } from "@webpack/common";

import { settings } from "../index";

interface OverlayProps {
    stream: MediaStream;
    title: string;
    onClose: () => void;
}

function ViewerOverlay({ stream, title, onClose }: OverlayProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x: settings.store.overlayX, y: settings.store.overlayY });
    const drag = useRef<{ dx: number; dy: number; } | null>(null);

    useEffect(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
    }, [stream]);

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
                <span className="p2ps-overlay-title">🔴 {title}</span>
                <button onClick={() => void videoRef.current?.requestFullscreen()} title="Tela cheia">⛶</button>
                <button onClick={onClose} title="Fechar">✕</button>
            </div>
            <video ref={videoRef} autoPlay playsInline controls />
        </div>
    );
}

const mounted = new Map<string, { root: ReturnType<typeof createRoot>; container: HTMLElement; }>();

export function mountOverlay(
    sessionId: string,
    stream: MediaStream,
    title: string,
    onClose: () => void
): void {
    unmountOverlay(sessionId);

    const container = document.createElement("div");
    container.id = `p2ps-overlay-${sessionId}`;
    document.body.appendChild(container);

    const root = createRoot(container);
    root.render(<ViewerOverlay stream={stream} title={title} onClose={onClose} />);

    mounted.set(sessionId, { root, container });
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
