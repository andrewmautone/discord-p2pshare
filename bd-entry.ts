/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    getBroadcastState,
    getQuality,
    onBroadcastStateChange,
    setQuality,
    startBroadcast,
    stopBroadcast
} from "./broadcast";
import { DEFAULT_BUDGET_MBPS } from "./constants";
import { loadSetting, saveSetting, ui } from "./host/bd";
import { getCurrentUserId, getCurrentUsername, getUsername } from "./host/bd/api";
import { ensureHelper, helperError, helperReady, listAudioApps, syncHelper } from "./host/bd/audioHelper";
import { startUpdateChecks } from "./host/bd/updater";
import { getActiveBeacons, initWatcher, isWatching, onBeaconsChange, startWatching } from "./watch";

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

        // Parado, o botão inicia. Transmitindo, ele abre o menu — parar vira
        // uma opção lá dentro, junto de resolução e taxa de quadros.
        const toggle = (anchor: HTMLElement) => {
            if (!getBroadcastState().active) {
                void startBroadcast();
                return;
            }

            ui.openBroadcastMenu(anchor, {
                quality: getQuality(),
                onQuality: q => setQuality(q),
                onStop: () => { void stopBroadcast(); }
            });
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
            const users: { id: string; names: string[]; onWatch?: () => void; }[] = [];

            if (getBroadcastState().active) {
                const me = getCurrentUserId();
                users.push({ id: me, names: [getUsername(me), getCurrentUsername()] });
            }

            for (const b of getActiveBeacons()) {
                users.push({
                    id: b.broadcasterId,
                    names: [getUsername(b.broadcasterId), b.broadcasterName],
                    // Já assistindo: o selo vira informativo, sem ação repetida.
                    onWatch: isWatching(b.sessionId)
                        ? undefined
                        : () => {
                            // Da lista lateral dá para clicar sem estar vendo a
                            // chamada; sem isto o vídeo abriria fora de vista.
                            ui.focusChannel(b.channelId);
                            void startWatching(b);
                        }
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

        // Instala ou atualiza o componente de áudio em segundo plano. É o
        // caminho por onde quem vinha de uma versão sem ele passa a tê-lo.
        void syncHelper();

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

        const modeLabel = document.createElement("div");
        modeLabel.textContent = "Áudio da transmissão";
        modeLabel.style.cssText = "margin-top:20px;margin-bottom:4px";

        const modeHint = document.createElement("div");
        modeHint.textContent =
            "O Windows não deixa o navegador capturar o áudio de um app só — " +
            "o loopback comum traz a máquina inteira, o Discord junto, e quem " +
            "assiste ouve a chamada de volta. O modo sem o Discord usa um " +
            "programa auxiliar (140 KB) que o plugin baixa na primeira vez, " +
            "com sua confirmação.";
        modeHint.style.cssText =
            "font-size:12px;color:var(--text-muted,#72767d);margin-bottom:8px";

        const mode = document.createElement("select");
        mode.style.cssText =
            "width:100%;padding:6px;background:var(--input-background,#1e1f22);" +
            "color:inherit;border:1px solid var(--background-tertiary,#202225);border-radius:4px";

        const currentMode = loadSetting("audioMode", "isolated");
        for (const [value, text] of [
            ["isolated", "Sem o áudio do Discord (recomendado)"],
            ["app", "Apenas um programa"],
            ["system", "Sistema inteiro, Discord incluído"]
        ] as [string, string][]) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = text;
            option.selected = value === currentMode;
            mode.appendChild(option);
        }

        // Estado do componente nativo, com o botão de instalar do lado.
        const helperRow = document.createElement("div");
        helperRow.style.cssText =
            "display:flex;align-items:center;gap:10px;margin-top:10px;font-size:12px";

        const helperStatus = document.createElement("span");
        const helperBtn = document.createElement("button");
        helperBtn.type = "button";
        helperBtn.textContent = "Tentar de novo";
        helperBtn.style.cssText =
            "padding:5px 10px;border:none;border-radius:3px;cursor:pointer;" +
            "background:var(--brand-experiment,#5865f2);color:#fff;font-size:12px";

        const paintHelper = () => {
            const ready = helperReady();
            const err = helperError();
            helperStatus.textContent = ready
                ? "Componente de áudio instalado."
                : err
                    ? `Não deu para instalar o componente: ${err}. ` +
                      "Enquanto isso, os modos acima usam o áudio do sistema."
                    : "Componente de áudio indisponível — baixando em segundo plano. " +
                      "Enquanto isso, os modos acima usam o áudio do sistema.";
            helperStatus.style.color = ready
                ? "var(--text-positive, #23a55a)"
                : "var(--text-muted, #72767d)";
            helperBtn.style.display = ready ? "none" : "";
        };

        helperBtn.addEventListener("click", async () => {
            helperBtn.disabled = true;
            helperBtn.textContent = "Baixando…";
            await ensureHelper();
            helperBtn.disabled = false;
            helperBtn.textContent = "Tentar de novo";
            paintHelper();
        });

        helperRow.append(helperStatus, helperBtn);
        paintHelper();

        // Seletor do programa, visível só no modo correspondente.
        const appRow = document.createElement("div");
        appRow.style.marginTop = "10px";

        const appSelect = document.createElement("select");
        appSelect.style.cssText = mode.style.cssText;

        const appHint = document.createElement("div");
        appHint.textContent =
            "A lista mostra os programas que estão emitindo som agora — um jogo " +
            "que ainda não tocou nada não aparece. A escolha é guardada pelo nome " +
            "do executável, então continua valendo depois de fechar e abrir.";
        appHint.style.cssText =
            "font-size:12px;color:var(--text-muted,#72767d);margin-top:4px";

        const savedApp = loadSetting<string | null>("audioApp", null);

        const fillApps = async () => {
            appSelect.textContent = "";

            const placeholder = document.createElement("option");
            placeholder.value = "";
            placeholder.textContent = "Procurando programas com som…";
            appSelect.appendChild(placeholder);

            const apps = await listAudioApps();
            appSelect.textContent = "";

            if (!apps.length) {
                const empty = document.createElement("option");
                empty.value = "";
                empty.textContent = "Nenhum programa tocando som agora";
                appSelect.appendChild(empty);
                return;
            }

            // O próprio Discord na lista só serviria para trazer o eco de volta.
            for (const app of apps.filter(a => !/discord/i.test(a.name))) {
                const option = document.createElement("option");
                option.value = app.name;
                option.textContent = app.name;
                option.selected = app.name === savedApp;
                appSelect.appendChild(option);
            }
        };

        appSelect.addEventListener("change", () =>
            saveSetting("audioApp", appSelect.value || null));

        // Reabrir a lista ao focar: entre abrir as configurações e escolher, o
        // usuário pode ter ligado o jogo.
        appSelect.addEventListener("focus", () => { void fillApps(); });

        appRow.append(appSelect, appHint);

        const syncAppRow = () => {
            appRow.style.display = mode.value === "app" ? "" : "none";
            helperRow.style.display = mode.value === "system" ? "none" : "";
            if (mode.value === "app") void fillApps();
        };

        mode.addEventListener("change", () => {
            saveSetting("audioMode", mode.value);
            syncAppRow();
        });

        syncAppRow();

        wrap.append(label, hint, slider, auto, autoHint, audio, audioHint,
            modeLabel, modeHint, mode, helperRow, appRow);
        return wrap;
    }
}
