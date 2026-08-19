/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getBroadcastState, onBroadcastStateChange, startBroadcast, stopBroadcast } from "./broadcast";
import { DEFAULT_BUDGET_MBPS } from "./constants";
import { loadSetting, saveSetting, ui } from "./host/bd";
import { getCurrentUserId, getCurrentUsername, getUsername } from "./host/bd/api";
import { startUpdateChecks } from "./host/bd/updater";
import { getActiveBeacons, initWatcher, onBeaconsChange } from "./watch";

declare const BdApi: any;

/**
 * Entrada do plugin no BetterDiscord.
 *
 * O BD espera um módulo CommonJS exportando uma classe com start/stop. Todo o
 * resto do plugin é o mesmo código da versão Vencord — só o host muda, e ele é
 * trocado no momento do build.
 */
export default class P2PShare {
    private cleanupWatcher: (() => void) | null = null;
    private cleanupState: (() => void) | null = null;
    private cleanupUpdater: (() => void) | null = null;
    private cleanupVoiceBtn: (() => void) | null = null;
    private cleanupBeacons: (() => void) | null = null;

    start(): void {
        ui.injectStyles();

        const toggle = () => {
            if (getBroadcastState().active) void stopBroadcast();
            else void startBroadcast();
        };

        this.cleanupWatcher = initWatcher();

        ui.mountLauncher({
            position: {
                x: loadSetting("launcherX", window.innerWidth - 80),
                y: loadSetting("launcherY", window.innerHeight - 160)
            },
            onToggle: toggle,
            onMoved: pos => {
                saveSetting("launcherX", pos.x);
                saveSetting("launcherY", pos.y);
            }
        });

        // Botao no painel de voz do Discord, ao lado do de tela nativo.
        // O flutuante fica como reserva: se o Discord mudar o HTML e a injecao
        // parar de achar onde encaixar, ele reaparece sozinho.
        this.cleanupVoiceBtn = ui.mountVoiceButton({
            onToggle: toggle,
            onAnchorChange: found => ui.setLauncherHidden(found)
        });

        // Quem aparece com AO VIVO: eu, se estiver transmitindo, mais todo
        // beacon ativo no canal.
        const refreshLive = () => {
            const users: { id: string; names: string[]; }[] = [];

            if (getBroadcastState().active) {
                const me = getCurrentUserId();
                users.push({ id: me, names: [getUsername(me), getCurrentUsername()] });
            }

            for (const b of getActiveBeacons()) {
                users.push({
                    id: b.broadcasterId,
                    names: [getUsername(b.broadcasterId), b.broadcasterName]
                });
            }

            ui.setLiveUsers(users);
        };

        this.cleanupBeacons = onBeaconsChange(refreshLive);

        this.cleanupState = onBroadcastStateChange(state => {
            ui.updateLauncher(state);
            ui.updateVoiceButton(state);
            refreshLive();
        });

        // Não bloqueia o start: se o host estiver fora do ar, o plugin sobe igual.
        this.cleanupUpdater = startUpdateChecks();

        // Dá tempo do painel de voz renderizar antes de fotografar o estado.
        setTimeout(() => ui.dumpVoiceDiagnostics(), 8000);
    }

    stop(): void {
        void stopBroadcast();

        this.cleanupState?.();
        this.cleanupState = null;

        this.cleanupBeacons?.();
        this.cleanupBeacons = null;

        this.cleanupVoiceBtn?.();
        this.cleanupVoiceBtn = null;

        this.cleanupUpdater?.();
        this.cleanupUpdater = null;

        this.cleanupWatcher?.();
        this.cleanupWatcher = null;

        ui.unmountLauncher();
        ui.unmountAllOverlays();
        ui.removeStyles();
    }

    getSettingsPanel(): HTMLElement {
        const wrap = document.createElement("div");
        wrap.style.color = "var(--header-primary, #fff)";

        const label = document.createElement("div");
        const current = loadSetting("uploadBudgetMbps", DEFAULT_BUDGET_MBPS);
        label.textContent = `Orçamento de upload: ${current} Mbps`;
        label.style.marginBottom = "8px";

        const hint = document.createElement("div");
        hint.textContent =
            "Dividido entre os viewers conectados. 15 Mbps dá 1080p60 para 2 pessoas " +
            "ou 720p30 para 6.";
        hint.style.cssText = "font-size:12px;color:var(--text-muted,#72767d);margin-bottom:12px";

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = "2";
        slider.max = "100";
        slider.step = "1";
        slider.value = String(current);
        slider.style.width = "100%";
        slider.addEventListener("input", () => {
            label.textContent = `Orçamento de upload: ${slider.value} Mbps`;
            saveSetting("uploadBudgetMbps", Number(slider.value));
        });

        const auto = document.createElement("label");
        auto.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:20px;cursor:pointer";

        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = loadSetting("autoUpdate", true);
        check.addEventListener("change", () => saveSetting("autoUpdate", check.checked));

        const autoText = document.createElement("span");
        autoText.textContent = "Atualizar sozinho quando sair versão nova";

        auto.append(check, autoText);

        const autoHint = document.createElement("div");
        autoHint.textContent =
            "Desligado, o plugin apenas avisa e espera você clicar. " +
            "Nunca atualiza durante uma transmissão.";
        autoHint.style.cssText =
            "font-size:12px;color:var(--text-muted,#72767d);margin-top:4px";

        const audio = document.createElement("label");
        audio.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:20px;cursor:pointer";

        const audioCheck = document.createElement("input");
        audioCheck.type = "checkbox";
        audioCheck.checked = loadSetting("captureAudio", true);
        audioCheck.addEventListener("change", () => saveSetting("captureAudio", audioCheck.checked));

        const audioText = document.createElement("span");
        audioText.textContent = "Transmitir o áudio do sistema";

        audio.append(audioCheck, audioText);

        const audioHint = document.createElement("div");
        audioHint.textContent =
            "O Windows só permite capturar o áudio inteiro da máquina, e isso " +
            "inclui o próprio Discord — quem assiste ouve a chamada de volta. " +
            "Desligue se isso incomodar.";
        audioHint.style.cssText =
            "font-size:12px;color:var(--text-muted,#72767d);margin-top:4px";

        wrap.append(label, hint, slider, auto, autoHint, audio, audioHint);
        return wrap;
    }
}
