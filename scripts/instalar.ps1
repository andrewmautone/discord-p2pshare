# Instalador do P2PShare para BetterDiscord.
#
# Nao patcha o Discord por conta propria: quando o BetterDiscord nao esta
# instalado, baixa e abre o instalador oficial deles. Reimplementar aquele
# patch aqui arriscaria quebrar a instalacao do Discord de quem roda isto,
# e ainda tiraria o updater proprio do BD do caminho.

$ErrorActionPreference = "Stop"

$bdRoot = Join-Path $env:APPDATA "BetterDiscord"
$bdPlugins = Join-Path $bdRoot "plugins"
$pluginName = "P2PShare.plugin.js"
$pluginSource = Join-Path $PSScriptRoot $pluginName

function Write-Step($text) {
    Write-Host ""
    Write-Host "==> $text" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "  P2PShare - compartilhamento de tela ponto-a-ponto" -ForegroundColor White
Write-Host "  ------------------------------------------------" -ForegroundColor DarkGray

if (-not (Test-Path $pluginSource)) {
    Write-Host ""
    Write-Host "  Nao achei o $pluginName nesta pasta." -ForegroundColor Red
    Write-Host "  Extraia o zip inteiro antes de rodar o instalador." -ForegroundColor Red
    Read-Host "`n  Enter para sair"
    exit 1
}

# --- 1. Aviso de conflito ---------------------------------------------------

$vencord = Join-Path $env:APPDATA "Vencord"
if (Test-Path $vencord) {
    Write-Step "Atencao: encontrei o Vencord instalado"
    Write-Host "  BetterDiscord e Vencord patcham o Discord no mesmo lugar." -ForegroundColor Yellow
    Write-Host "  Rodar os dois junto da problema. Desinstale um deles." -ForegroundColor Yellow
    $answer = Read-Host "`n  Continuar mesmo assim? (s/N)"
    if ($answer -ne "s") {
        Write-Host "  Cancelado." -ForegroundColor DarkGray
        exit 0
    }
}

# --- 2. BetterDiscord -------------------------------------------------------

if (-not (Test-Path $bdRoot)) {
    Write-Step "BetterDiscord nao encontrado - baixando o instalador oficial"

    $installer = Join-Path $env:TEMP "BetterDiscord-Windows.exe"
    $url = "https://github.com/BetterDiscord/Installer/releases/latest/download/BetterDiscord-Windows.exe"

    try {
        Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
    } catch {
        Write-Host "  Falha no download: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Baixe manualmente em https://betterdiscord.app e rode este script de novo." -ForegroundColor Red
        Read-Host "`n  Enter para sair"
        exit 1
    }

    Write-Host "  Abrindo o instalador do BetterDiscord." -ForegroundColor White
    Write-Host "  Escolha 'Install', conclua, e volte para esta janela." -ForegroundColor White

    Start-Process -FilePath $installer -Wait
    Read-Host "`n  Terminou a instalacao do BetterDiscord? Enter para continuar"

    if (-not (Test-Path $bdRoot)) {
        Write-Host ""
        Write-Host "  Ainda nao vejo o BetterDiscord instalado." -ForegroundColor Red
        Write-Host "  Instale e rode este script de novo." -ForegroundColor Red
        Read-Host "`n  Enter para sair"
        exit 1
    }
} else {
    Write-Step "BetterDiscord ja esta instalado"
}

# --- 3. Plugin --------------------------------------------------------------

Write-Step "Instalando o plugin"

if (-not (Test-Path $bdPlugins)) {
    New-Item -ItemType Directory -Path $bdPlugins -Force | Out-Null
}

Copy-Item -Path $pluginSource -Destination (Join-Path $bdPlugins $pluginName) -Force
Write-Host "  Copiado para $bdPlugins" -ForegroundColor Green

# --- 4. Fim -----------------------------------------------------------------

Write-Host ""
Write-Host "  Pronto." -ForegroundColor Green
Write-Host ""
Write-Host "  Falta so:" -ForegroundColor White
Write-Host "    1. Reiniciar o Discord (fechar pela bandeja do sistema tambem)"
Write-Host "    2. Configuracoes > BetterDiscord > Plugins > ligar o P2PShare"
Write-Host ""
Write-Host "  Para usar: entre num canal de voz e clique no botao flutuante"
Write-Host "  de tela. Ele pergunta qual janela compartilhar."
Write-Host ""

Read-Host "  Enter para sair"
