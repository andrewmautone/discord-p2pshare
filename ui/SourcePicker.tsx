/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./sourcePicker.css";

import type { RenderModalProps } from "@vencord/discord-types";
import { Button, Forms, Modal, openModal, useState } from "@webpack/common";

import type { CaptureSource } from "../capture";

/**
 * O shape exato do que o DiscordNative devolve varia entre versões: às vezes a
 * miniatura vem como `thumbnail`, às vezes como `url`, às vezes não vem. Lemos
 * as três e caímos para um card sem imagem quando nenhuma existe.
 */
function thumbnailOf(source: CaptureSource): string | null {
    const raw = source as unknown as Record<string, unknown>;

    for (const key of ["thumbnail", "url", "image"]) {
        const value = raw[key];

        if (typeof value === "string" && value.startsWith("data:")) return value;

        // NativeImage do Electron expõe toDataURL()
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

/** Telas inteiras vêm com id "screen:...", janelas com "window:...". */
function isScreen(source: CaptureSource): boolean {
    return source.id.startsWith("screen:");
}

interface PickerProps {
    sources: CaptureSource[];
    onPick: (id: string | null) => void;
    modalProps: RenderModalProps;
}

function SourcePicker({ sources, onPick, modalProps }: PickerProps) {
    const [tab, setTab] = useState<"screen" | "window">(
        sources.some(isScreen) ? "screen" : "window"
    );
    const [selected, setSelected] = useState<string | null>(null);

    const shown = sources.filter(s => (tab === "screen" ? isScreen(s) : !isScreen(s)));

    const confirm = (id: string | null) => {
        onPick(id);
        modalProps.onClose();
    };

    return (
        <Modal
            {...modalProps}
            title="Compartilhar via P2P"
            actions={[{
                text: "Transmitir",
                variant: "primary",
                disabled: selected === null,
                onClick: () => confirm(selected)
            }]}
        >
            <div className="p2ps-picker-tabs">
                <Button
                    size={Button.Sizes.SMALL}
                    color={tab === "screen" ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                    onClick={() => { setTab("screen"); setSelected(null); }}
                >
                    Tela inteira
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={tab === "window" ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                    onClick={() => { setTab("window"); setSelected(null); }}
                >
                    Aplicativos
                </Button>
            </div>

            {shown.length === 0 && (
                <Forms.FormText>Nenhuma fonte encontrada nesta aba.</Forms.FormText>
            )}

            <div className="p2ps-picker-grid">
                {shown.map(source => {
                    const thumb = thumbnailOf(source);

                    return (
                        <div
                            key={source.id}
                            className={
                                "p2ps-picker-card" +
                                (selected === source.id ? " p2ps-picker-card-selected" : "")
                            }
                            onClick={() => setSelected(source.id)}
                            onDoubleClick={() => confirm(source.id)}
                        >
                            <div className="p2ps-picker-thumb">
                                {thumb
                                    ? <img src={thumb} alt="" />
                                    : <span className="p2ps-picker-noimg">sem prévia</span>}
                            </div>
                            <div className="p2ps-picker-name" title={source.name}>
                                {source.name}
                            </div>
                        </div>
                    );
                })}
            </div>
        </Modal>
    );
}

/**
 * Abre o seletor e resolve com o id escolhido, ou null se cancelar.
 * Encaixa direto no `pickSource` de captureScreen.
 */
export function openSourcePicker(sources: CaptureSource[]): Promise<string | null> {
    return new Promise(resolve => {
        let settled = false;
        const settle = (id: string | null) => {
            if (settled) return;
            settled = true;
            resolve(id);
        };

        openModal(
            modalProps => (
                <SourcePicker sources={sources} onPick={settle} modalProps={modalProps} />
            ),
            // Fechar no X ou no Esc conta como cancelar.
            { onCloseCallback: () => settle(null) }
        );
    });
}
