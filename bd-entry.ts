/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    getBroadcastState,
    getCurrentBitrate,
    getQuality,
    onBroadcastStateChange,
    setQuality,
    startBroadcast,
    stopBroadcast
} from "./broadcast";
import { DEFAULT_BUDGET_MBPS } from "./constants";
import { loadSetting, saveSetting, ui } from "./host/bd";
import {
    getCurrentUserId,
    hasCurrentUser,
    getCurrentUsername,
    getUsername,
    onVoiceChannelChange
} from "./host/bd/api";
import {
    ensureHelper,
    helperError,
    helperReady,
    removeHelper,
    syncHelper
} from "./host/bd/audioHelper";
import {
    playStreamStarted,
    playStreamStopped,
    playViewerJoined,
    warmSounds
} from "./host/bd/sounds";
import { startUpdateChecks } from "./host/bd/updater";
import {
    beaconIsHere,
    getActiveBeacons,
    initWatcher,
    isWatching,
    onBeaconsChange,
    startWatching
} from "./watch";
import { stopSignaling } from "./signaling";

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
    private cleanupVoice: (() => void) | null = null;

    /** Relógio de espera pelo login; parar o plugin antes disso o cancela. */
    private readyTimer: ReturnType<typeof setInterval> | null = null;

    /**
     * O carregador pode chamar start() antes de o Discord ter o usuário
     * logado. Sem usuário nada funciona (o watcher precisa do próprio id),
     * então espera ele aparecer em vez de explodir.
     */
    start(): void {
        if (hasCurrentUser()) {
            this.startReady();
            return;
        }

        console.info("[P2PShare] esperando o login do Discord para iniciar");
        this.readyTimer = setInterval(() => {
            if (!hasCurrentUser()) return;
            if (this.readyTimer) clearInterval(this.readyTimer);
            this.readyTimer = null;
            this.startReady();
        }, 500);
    }

    private startReady(): void {
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
                onStop: () => { void stopBroadcast(); },
                currentBitrate: getCurrentBitrate
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
        // aviso vivo nos canais de voz do servidor.
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
                            // Fora da chamada, startWatching só explica que é
                            // preciso entrar. Dentro, foca a chamada antes:
                            // da lista lateral dá para clicar sem estar vendo.
                            if (beaconIsHere(b)) ui.focusChannel(b.channelId);
                            void startWatching(b);
                        }
                });
            }

            ui.setLiveUsers(users);
        };

        this.cleanupBeacons = onBeaconsChange(refreshLive);

        // O selo é silencioso de propósito: sem som e sem notificação para o
        // aviso de outra pessoa. Trocar de chamada muda o que dá para assistir
        // (o selo só abre o vídeo de dentro da mesma sala), então repinta.
        this.cleanupVoice = onVoiceChannelChange(() => refreshLive());

        // Só o transmissor ouve alguém entrando — é ele que precisa saber.
        let { viewers, active } = getBroadcastState();

        this.cleanupState = onBroadcastStateChange(state => {
            ui.updateLauncher(state);
            ui.updateVoiceButton(state);
            refreshLive();

            // O som do início vinha do beacon, e o plugin descarta o próprio
            // beacon de propósito — quem transmite não é espectador de si
            // mesmo. Resultado: todo mundo no canal ouvia o começo, menos
            // quem começou. Aqui é o único lugar que sabe da minha própria
            // transmissão.
            if (state.active && !active) playStreamStarted();
            if (!state.active && active) playStreamStopped();
            active = state.active;

            if (state.viewers > viewers) playViewerJoined();
            viewers = state.viewers;
        });

        // Não bloqueia o start: se o host estiver fora do ar, o plugin sobe igual.
        this.cleanupUpdater = startUpdateChecks();


        // Instala ou atualiza o componente de áudio em segundo plano. É o
        // caminho por onde quem vinha de uma versão sem ele passa a tê-lo.
        void syncHelper();

        // O módulo de som é caro de achar e o Discord ainda está montando os
        // seus quando o plugin sobe. Achar agora tira esse custo do instante
        // em que a transmissão começa.
        setTimeout(warmSounds, 5000);

        // Dá tempo do painel de voz renderizar antes de fotografar o estado.
        setTimeout(() => ui.dumpVoiceDiagnostics(), 8000);
    }

    stop(): void {
        if (this.readyTimer) {
            clearInterval(this.readyTimer);
            this.readyTimer = null;
            return;
        }

        void stopBroadcast();

        this.cleanupState?.();
        this.cleanupState = null;

        this.cleanupBeacons?.();
        this.cleanupBeacons = null;

        this.cleanupVoice?.();
        this.cleanupVoice = null;

        this.cleanupVoiceBtn?.();
        this.cleanupVoiceBtn = null;

        this.cleanupUpdater?.();
        this.cleanupUpdater = null;

        this.cleanupWatcher?.();
        this.cleanupWatcher = null;

        // Dá um instante para o aviso de fim sair antes de fechar os relays;
        // se não sair, o aviso expira sozinho nos outros em segundos.
        setTimeout(stopSignaling, 1500);

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
            "O áudio acompanha o que você compartilha: escolhendo uma janela, " +
            "vai só o som daquele programa; escolhendo um monitor, vai tudo " +
            "menos o Discord — assim quem assiste não ouve a própria chamada " +
            "de volta. Isso depende de um programa auxiliar de 140 KB, que o " +
            "plugin instala sozinho.";
        modeHint.style.cssText =
            "font-size:12px;color:var(--text-muted,#72767d);margin-bottom:8px";

        const helperRow = document.createElement("div");
        helperRow.style.cssText =
            "display:flex;align-items:center;gap:10px;font-size:12px";

        const helperStatus = document.createElement("span");
        const helperBtn = document.createElement("button");
        helperBtn.type = "button";
        helperBtn.style.cssText =
            "padding:5px 10px;border:none;border-radius:3px;cursor:pointer;" +
            "color:#fff;font-size:12px;flex-shrink:0";

        const paintHelper = () => {
            const ready = helperReady();
            const err = helperError();

            helperStatus.textContent = ready
                ? "Componente de áudio instalado."
                : err
                    ? `Não deu para instalar: ${err}`
                    : "Instalando o componente de áudio…";
            helperStatus.style.color = ready
                ? "var(--text-positive, #23a55a)"
                : "var(--text-muted, #72767d)";

            helperBtn.textContent = ready ? "Desinstalar" : "Tentar de novo";
            helperBtn.style.background = ready
                ? "var(--status-danger, #ed4245)"
                : "var(--brand-experiment, #5865f2)";
        };

        helperBtn.addEventListener("click", async () => {
            helperBtn.disabled = true;

            if (helperReady()) {
                removeHelper();
            } else {
                helperBtn.textContent = "Baixando…";
                await ensureHelper();
            }

            helperBtn.disabled = false;
            paintHelper();
        });

        helperRow.append(helperStatus, helperBtn);
        paintHelper();

        // O download roda em segundo plano: sem repintar, o painel ficaria
        // dizendo "instalando" para sempre. Para quando a tela sai do DOM.
        const timer = setInterval(() => {
            if (!wrap.isConnected) {
                clearInterval(timer);
                return;
            }
            paintHelper();
        }, 1500);

        wrap.append(label, hint, slider, auto, autoHint, audio, audioHint,
            modeLabel, modeHint, helperRow);
        return wrap;
    }
}
