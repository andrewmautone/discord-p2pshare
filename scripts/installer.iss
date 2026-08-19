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
#define VcInstaller  "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe"

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

{ O patcher e o arquivo que o Discord carrega quando esta com Vencord.
  Checar por ele, e nao pela pasta, evita falso positivo de quem desinstalou
  o Vencord mas manteve temas e configuracoes salvos. }
function VencordPresent(): Boolean;
begin
  Result := FileExists(ExpandConstant('{userappdata}\Vencord\dist\patcher.js'));
end;

{ Desinstala o Vencord chamando o CLI oficial deles.
  Nao desfazemos o patch na mao pelo mesmo motivo de nao aplicarmos o do
  BetterDiscord: errar ali quebraria o Discord de quem esta rodando isto. }
function UninstallVencord(): Boolean;
var
  Cli: String;
  Branches: array[0..2] of String;
  I, ResultCode: Integer;
begin
  Result := False;

  if MsgBox('Feche o Discord completamente antes de continuar.' + #13#10 + #13#10 +
            'Inclusive pelo icone na bandeja do sistema, perto do relogio — ' +
            'fechar so a janela nao basta.' + #13#10 + #13#10 +
            'Ja fechou?',
            mbConfirmation, MB_YESNO) = IDNO then
    Exit;

  try
    DownloadTemporaryFile('{#VcInstaller}', 'VencordInstallerCli.exe', '', nil);
  except
    MsgBox('Nao consegui baixar o desinstalador do Vencord.' + #13#10 +
           'Verifique sua conexao e tente de novo.', mbError, MB_OK);
    Exit;
  end;

  Cli := ExpandConstant('{tmp}\VencordInstallerCli.exe');
  if not FileExists(Cli) then
  begin
    MsgBox('O download do desinstalador do Vencord nao completou.', mbError, MB_OK);
    Exit;
  end;

  Branches[0] := 'stable';
  Branches[1] := 'ptb';
  Branches[2] := 'canary';

  { Roda para cada branch: o CLI simplesmente nao faz nada nas que nao existem.

    O stdin PRECISA vir de NUL. O CLI do Vencord termina com "Press Enter to
    exit" e fica bloqueado esperando input; rodando escondido nao existe
    ninguem para apertar Enter, e o instalador congela por minutos sem dar
    sinal nenhum. Com NUL o stdin da EOF na hora e ele encerra sozinho.

    Medido: 4,5 minutos travado sem isto, 0,42 segundos com. }
  for I := 0 to 2 do
    Exec(ExpandConstant('{cmd}'),
         '/C ""' + Cli + '" -uninstall -branch ' + Branches[I] + '" < NUL',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { Tira o codigo injetado, mas preserva configuracoes e temas do usuario
    caso ele queira voltar para o Vencord um dia. }
  DelTree(ExpandConstant('{userappdata}\Vencord\dist'), True, True, True);

  Result := not VencordPresent();
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
var
  Labels: TArrayOfString;
  Answer: Integer;
begin
  Result := True;

  if VencordPresent() then
  begin
    SetArrayLength(Labels, 3);
    Labels[0] := 'Remover o Vencord e continuar';
    Labels[1] := 'Manter os dois (nao recomendado)';
    Labels[2] := 'Cancelar';

    Answer := TaskDialogMsgBox(
      'O Vencord esta instalado nesta maquina',
      'BetterDiscord e Vencord modificam o Discord no mesmo lugar. Rodar os ' +
      'dois junto costuma dar problema.' + #13#10 + #13#10 +
      'Posso remover o Vencord para voce usando o desinstalador oficial dele. ' +
      'Suas configuracoes e temas do Vencord ficam salvos, caso voce queira ' +
      'voltar depois.',
      mbConfirmation, MB_YESNOCANCEL, Labels, 0);

    if Answer = IDCANCEL then
    begin
      Result := False;
      Exit;
    end;

    if Answer = IDYES then
    begin
      if not UninstallVencord() then
      begin
        MsgBox('Nao consegui remover o Vencord.' + #13#10 + #13#10 +
               'Desinstale manualmente pelo instalador do Vencord e rode ' +
               'este instalador de novo.', mbError, MB_OK);
        Result := False;
        Exit;
      end;

      MsgBox('Vencord removido.', mbInformation, MB_OK);
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
