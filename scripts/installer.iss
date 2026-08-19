; Instalador do P2PShare para Windows.
;
; Instala por usuario (sem UAC): o plugin mora em %AppData%, entao pedir
; privilegio de administrador so serviria para deixar o aviso do Windows
; mais assustador do que ja e.
;
; Compilar:  ISCC.exe scripts\installer.iss
; Saida:     release\P2PShare-Setup.exe

#define AppName      "P2PShare"
#define AppVersion   "1.0.0"
#define AppPublisher "Andrew"
#define AppUrl       "https://github.com/andrewmautone/vencord-p2pshare"
#define BdInstaller  "https://github.com/BetterDiscord/Installer/releases/latest/download/BetterDiscord-Windows.exe"

[Setup]
AppId={{8E3A17C4-5B2D-4F91-9E6A-7C4D2B1F0A83}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppSupportURL={#AppUrl}
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Compartilhamento de tela ponto-a-ponto para Discord

; Sem UAC. O destino esta dentro do perfil do usuario.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

DefaultDirName={userappdata}\BetterDiscord\plugins
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
CreateAppDir=no
Uninstallable=yes
UninstallDisplayName={#AppName}
UninstallFilesDir={userappdata}\BetterDiscord\P2PShare

OutputDir=..\release
OutputBaseFilename=P2PShare-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\release\P2PShare.plugin.js"; DestDir: "{userappdata}\BetterDiscord\plugins"; Flags: ignoreversion
Source: "..\release\LEIA-ME.txt";        DestDir: "{userappdata}\BetterDiscord\P2PShare"; Flags: ignoreversion

[Messages]
brazilianportuguese.WelcomeLabel2=Isto vai instalar o {#AppName} no seu BetterDiscord.%n%nO P2PShare deixa voce compartilhar a tela direto com quem esta no canal de voz, sem passar pela infraestrutura de video do Discord.%n%nTodo mundo que for assistir precisa ter o plugin instalado tambem.

[Code]
var
  BdWasMissing: Boolean;

function BetterDiscordPresent(): Boolean;
begin
  Result := DirExists(ExpandConstant('{userappdata}\BetterDiscord'));
end;

function VencordPresent(): Boolean;
begin
  Result := DirExists(ExpandConstant('{userappdata}\Vencord'));
end;

{ Baixa e roda o instalador oficial do BetterDiscord.
  Nao reimplementamos o patch deles de proposito: errar um detalhe ali
  quebraria a instalacao do Discord de quem esta rodando isto. }
function InstallBetterDiscord(): Boolean;
var
  TempFile: String;
  ResultCode: Integer;
begin
  Result := False;
  TempFile := ExpandConstant('{tmp}\BetterDiscord-Windows.exe');

  { DownloadTemporaryFile levanta excecao quando a rede falha. }
  try
    DownloadTemporaryFile('{#BdInstaller}', 'BetterDiscord-Windows.exe', '', nil);
  except
    MsgBox('Nao consegui baixar o instalador do BetterDiscord.' + #13#10 +
           'Verifique sua conexao, ou instale manualmente em betterdiscord.app ' +
           'e rode este instalador de novo.',
           mbError, MB_OK);
    Exit;
  end;

  if not FileExists(TempFile) then
  begin
    MsgBox('O download do BetterDiscord nao completou.' + #13#10 +
           'Instale manualmente em betterdiscord.app e rode este instalador de novo.',
           mbError, MB_OK);
    Exit;
  end;

  MsgBox('Vou abrir o instalador do BetterDiscord.' + #13#10 + #13#10 +
         'Escolha "Install", conclua, e volte para esta janela.',
         mbInformation, MB_OK);

  if not Exec(TempFile, '', '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
  begin
    MsgBox('Nao consegui abrir o instalador do BetterDiscord.', mbError, MB_OK);
    Exit;
  end;

  Result := BetterDiscordPresent();
end;

function InitializeSetup(): Boolean;
begin
  Result := True;

  if VencordPresent() then
  begin
    if MsgBox('Encontrei o Vencord instalado nesta maquina.' + #13#10 + #13#10 +
              'BetterDiscord e Vencord modificam o Discord no mesmo lugar, e ' +
              'rodar os dois junto costuma dar problema.' + #13#10 + #13#10 +
              'Continuar mesmo assim?',
              mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
      Exit;
    end;
  end;

  BdWasMissing := not BetterDiscordPresent();

  if BdWasMissing then
  begin
    if MsgBox('O BetterDiscord nao esta instalado, e o P2PShare precisa dele.' + #13#10 + #13#10 +
              'Quer instalar o BetterDiscord agora? Vou baixar o instalador ' +
              'oficial e abrir para voce.',
              mbConfirmation, MB_YESNO) = IDNO then
    begin
      Result := False;
      Exit;
    end;

    if not InstallBetterDiscord() then
    begin
      MsgBox('O BetterDiscord ainda nao aparece instalado.' + #13#10 +
             'Instale e rode este instalador de novo.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    MsgBox('Plugin instalado.' + #13#10 + #13#10 +
           'Falta so ligar ele:' + #13#10 +
           '  1. Reinicie o Discord (feche pela bandeja do sistema tambem)' + #13#10 +
           '  2. Configuracoes > BetterDiscord > Plugins' + #13#10 +
           '  3. Ligue o P2PShare' + #13#10 + #13#10 +
           'Para usar: entre num canal de voz e clique no botao flutuante ' +
           'de tela.',
           mbInformation, MB_OK);
  end;
end;
