; Instalador do P2PShare para Windows.
;
; Coloca o P2PShare direto no Discord, sem BetterDiscord:
;
;   %AppData%\P2PShare\                                 plugin, audio, core\ (carregador)
;   %LocalAppData%\Discord\app-*\resources\app.asar       o "gancho" (~1 KB)
;   %LocalAppData%\Discord\app-*\resources\app.orig.asar  o original do Discord,
;                                                         so renomeado
;
; O gancho liga o P2PShare e entrega o controle ao original, cujo conteudo
; nunca e alterado. Desinstalar apaga o gancho e devolve o nome ao original.
; Renomear exige o Discord fechado: o instalador pede permissao para fechar.
; (Uma pasta resources\app nao serve: o Electron 42 do Discord vai direto no
; app.asar.)
;
; Quem ja usa BetterDiscord continua recebendo o plugin dentro do BD, como
; antes: dois carregadores do P2PShare ao mesmo tempo dariam tudo em dobro.
;
; Por usuario, sem UAC: tudo mora dentro do perfil.
;
; Compilar:  node scripts\build-standalone.mjs   (ou ISCC.exe scripts\installer.iss)
; Saida:     release\P2PShare-Setup.exe

#define AppName      "P2PShare"

; A versao vem do build (ISCC /DAppVersion=x.y.z), que a le de constants.ts.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppPublisher "Andrew"
#define AppUrl       "https://github.com/andrewmautone/discord-p2pshare"
#define VcInstaller  "https://github.com/Vencord/Installer/releases/latest/download/VencordInstallerCli.exe"

[Setup]
; Mesmo AppId do instalador antigo (modo BetterDiscord): quem atualiza nao
; ganha uma segunda entrada em "Aplicativos instalados".
AppId={{8E3A17C4-5B2D-4F91-9E6A-7C4D2B1F0A83}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppSupportURL={#AppUrl}
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Compartilhamento de tela ponto-a-ponto para Discord

PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

DefaultDirName={userappdata}\P2PShare
; O instalador antigo gravou a pasta de plugins do BD como "pasta do app".
UsePreviousAppDir=no
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
Uninstallable=yes
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\p2pshare-audio.exe
UninstallFilesDir={app}\desinstalar

OutputDir=..\release
OutputBaseFilename=P2PShare-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=no

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
; Modo proprio (sem BetterDiscord)
Source: "..\release\P2PShare.plugin.js";               DestDir: "{app}";             Flags: ignoreversion; Check: StandaloneMode
Source: "..\release\p2pshare-audio.exe";               DestDir: "{app}";             Flags: ignoreversion; Check: StandaloneMode
Source: "..\release\standalone\core\main.js";          DestDir: "{app}\core";        Flags: ignoreversion; Check: StandaloneMode
Source: "..\release\standalone\core\preload.js";       DestDir: "{app}\core";        Flags: ignoreversion; Check: StandaloneMode
Source: "..\release\standalone\core\runtime.js";       DestDir: "{app}\core";        Flags: ignoreversion; Check: StandaloneMode
Source: "..\release\standalone\app.asar";              DestDir: "{app}\core";        Flags: ignoreversion; Check: StandaloneMode
Source: "..\release\standalone\core\p2pshare-launcher.vbs"; DestDir: "{app}\core";   Flags: ignoreversion; Check: StandaloneMode

; Modo BetterDiscord (igual ao instalador antigo)
Source: "..\release\P2PShare.plugin.js";               DestDir: "{userappdata}\BetterDiscord\plugins"; Flags: ignoreversion; Check: BdMode
Source: "..\release\p2pshare-audio.exe";               DestDir: "{userappdata}\BetterDiscord\plugins"; Flags: ignoreversion; Check: BdMode

Source: "..\release\LEIA-ME.txt";                      DestDir: "{app}";             Flags: ignoreversion

[Run]
Filename: "{localappdata}\Discord\Update.exe"; Parameters: "--processStart Discord.exe"; \
  Description: "Abrir o Discord agora"; \
  Flags: postinstall nowait skipifdoesntexist; Check: StandaloneMode

[Messages]
brazilianportuguese.WelcomeLabel2=Isto vai instalar o {#AppName} no seu Discord.%n%nO P2PShare deixa voce compartilhar a tela direto com quem esta no canal de voz, sem passar pela infraestrutura de video do Discord. Todo mundo que for assistir precisa ter o P2PShare tambem.%n%nCOMO FUNCIONA: o instalador poe um arquivo pequeno na instalacao do Discord que carrega o P2PShare; o arquivo original do Discord so e renomeado, sem alteracao. O Discord precisa ficar fechado durante a instalacao. A desinstalacao (Aplicativos instalados > P2PShare) desfaz tudo.%n%nAVISO: modificar o cliente do Discord viola os Termos de Servico do Discord. O risco e seu.

[Code]
const
  MARKER = 'p2pshareLoader';

var
  UseBd: Boolean;
  InstalledVer: String;
  PatchedCount: Integer;
  ForeignApp: String;

{ ------------------------------------------------------------ caminhos }

function ChannelDir(I: Integer): String;
begin
  case I of
    0: Result := ExpandConstant('{localappdata}\Discord');
    1: Result := ExpandConstant('{localappdata}\DiscordPTB');
    2: Result := ExpandConstant('{localappdata}\DiscordCanary');
  else
    Result := ExpandConstant('{localappdata}\DiscordDevelopment');
  end;
end;

{ O gancho tem ~1 KB e carrega a marca; o app.asar do Discord, megabytes. }
function IsOurAsar(const Path: String): Boolean;
var
  Size: Int64;
  Raw: AnsiString;
begin
  Result := False;
  if not FileSize64(Path, Size) then Exit;
  if Size > 65536 then Exit;
  if LoadStringFromFile(Path, Raw) then
    Result := Pos(MARKER, String(Raw)) > 0;
end;

{ ------------------------------------------------------------ deteccao }

function DiscordInstalled(): Boolean;
var
  I: Integer;
  R: TFindRec;
begin
  Result := False;
  for I := 0 to 3 do
    if FindFirst(ChannelDir(I) + '\app-*', R) then
    begin
      try
        repeat
          if FileExists(ChannelDir(I) + '\' + R.Name + '\resources\app.asar') or
             FileExists(ChannelDir(I) + '\' + R.Name + '\resources\app.orig.asar') then
            Result := True;
        until Result or not FindNext(R);
      finally
        FindClose(R);
      end;
      if Result then Exit;
    end;
end;

{ O BetterDiscord se instala no index.js do discord_desktop_core. Olhar o
  patch, e nao a pasta %AppData%\BetterDiscord, evita falso positivo de quem
  desinstalou o BD e manteve a pasta. }
function BdInjected(): Boolean;
var
  I: Integer;
  R, M: TFindRec;
  Base, IndexJs: String;
  Raw: AnsiString;
begin
  Result := False;
  for I := 0 to 3 do
    if FindFirst(ChannelDir(I) + '\app-*', R) then
    begin
      try
        repeat
          Base := ChannelDir(I) + '\' + R.Name + '\modules';
          if FindFirst(Base + '\discord_desktop_core-*', M) then
          begin
            try
              repeat
                IndexJs := Base + '\' + M.Name + '\discord_desktop_core\index.js';
                if LoadStringFromFile(IndexJs, Raw) then
                  if Pos('betterdiscord', Lowercase(String(Raw))) > 0 then
                    Result := True;
              until Result or not FindNext(M);
            finally
              FindClose(M);
            end;
          end;
        until Result or not FindNext(R);
      finally
        FindClose(R);
      end;
      if Result then Exit;
    end;
end;

function VencordPresent(): Boolean;
begin
  Result := FileExists(ExpandConstant('{userappdata}\Vencord\dist\patcher.js'));
end;

{ Por WMI, e nao por "tasklist | find": com Git instalado o find do Git vem
  antes do find.exe do Windows no PATH e a checagem dava sempre falso. }
function DiscordRunning(): Boolean;
var
  Locator, Service, Procs: Variant;
begin
  Result := False;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Procs := Service.ExecQuery(
      'SELECT ProcessId FROM Win32_Process WHERE Name = ''Discord.exe'' OR ' +
      'Name = ''DiscordPTB.exe'' OR Name = ''DiscordCanary.exe''');
    Result := Procs.Count > 0;
  except
    Result := False;
  end;
end;

{ Fecha o Discord, com permissao. False se a pessoa nao quis. }
function CloseDiscord(const Why: String): Boolean;
var
  ResultCode, Tries: Integer;
begin
  Result := True;
  if not DiscordRunning() then Exit;

  if MsgBox('O Discord esta aberto e precisa ser fechado ' + Why + '.' + #13#10 + #13#10 +
            'Fechar o Discord agora? (Se voce estiver numa chamada, ela cai.)',
            mbConfirmation, MB_YESNO) = IDNO then
  begin
    Result := False;
    Exit;
  end;

  { Caminho absoluto: nao depender do PATH de quem roda o instalador. }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM Discord.exe /IM DiscordPTB.exe /IM DiscordCanary.exe /F',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { Espera os processos soltarem os arquivos. }
  Tries := 0;
  while DiscordRunning() and (Tries < 20) do
  begin
    Sleep(250);
    Tries := Tries + 1;
  end;
  Sleep(500);
end;

function StandaloneMode(): Boolean;
begin
  Result := not UseBd;
end;

function BdMode(): Boolean;
begin
  Result := UseBd;
end;

{ ------------------------------------------------------------ versao }

function VersionIn(const Path: String): String;
var
  Content: AnsiString;
  P, I: Integer;
  Ch: Char;
begin
  Result := '';
  if not LoadStringFromFile(Path, Content) then Exit;

  P := Pos('@version', Content);
  if P = 0 then Exit;

  I := P + Length('@version');
  while (I <= Length(Content)) and (Content[I] = ' ') do
    I := I + 1;

  while I <= Length(Content) do
  begin
    Ch := Content[I];
    if ((Ch >= '0') and (Ch <= '9')) or (Ch = '.') then
      Result := Result + Ch
    else
      Break;
    I := I + 1;
  end;
end;

function ReadInstalledVersion(): String;
begin
  if UseBd then
    Result := VersionIn(ExpandConstant('{userappdata}\BetterDiscord\plugins\P2PShare.plugin.js'))
  else
    Result := VersionIn(ExpandConstant('{userappdata}\P2PShare\P2PShare.plugin.js'));
end;

{ -1 se A < B, 0 se iguais, 1 se A > B. Numero a numero: "1.10" > "1.9". }
function CompareVersions(A, B: String): Integer;
var
  PartA, PartB, DotA, DotB: Integer;
begin
  Result := 0;
  while (Length(A) > 0) or (Length(B) > 0) do
  begin
    DotA := Pos('.', A);
    if DotA = 0 then DotA := Length(A) + 1;
    DotB := Pos('.', B);
    if DotB = 0 then DotB := Length(B) + 1;

    PartA := StrToIntDef(Copy(A, 1, DotA - 1), 0);
    PartB := StrToIntDef(Copy(B, 1, DotB - 1), 0);

    if PartA > PartB then begin Result := 1; Exit; end;
    if PartA < PartB then begin Result := -1; Exit; end;

    A := Copy(A, DotA + 1, Length(A));
    B := Copy(B, DotB + 1, Length(B));
  end;
end;

function ConfirmReinstall(): Boolean;
var
  Cmp: Integer;
begin
  Cmp := CompareVersions('{#AppVersion}', InstalledVer);

  if Cmp > 0 then begin Result := True; Exit; end;

  if Cmp = 0 then
  begin
    Result := MsgBox('O P2PShare ' + InstalledVer + ' ja esta instalado.' + #13#10 + #13#10 +
                     'Instalar de novo por cima? (Isto tambem repara o P2PShare se uma ' +
                     'atualizacao do Discord o tiver removido.)',
                     mbConfirmation, MB_YESNO) = IDYES;
    Exit;
  end;

  Result := MsgBox('Voce ja tem o P2PShare ' + InstalledVer + ', que e mais novo ' +
                   'que o {#AppVersion} deste instalador.' + #13#10 + #13#10 +
                   'Instalar mesmo assim vai REBAIXAR a versao. Continuar?',
                   mbConfirmation, MB_YESNO) = IDYES;
end;

{ ------------------------------------------------------------ gancho no Discord }

procedure PatchVersionDir(const VersionDir: String);
var
  Res, Asar, Orig, Stub: String;
begin
  Res := VersionDir + '\resources';
  Asar := Res + '\app.asar';
  Orig := Res + '\app.orig.asar';
  Stub := ExpandConstant('{app}\core\app.asar');

  if not FileExists(Asar) then Exit;

  { Ja tem o gancho: so atualiza. }
  if IsOurAsar(Asar) then
  begin
    if FileExists(Orig) and FileCopy(Stub, Asar, False) then
      PatchedCount := PatchedCount + 1;
    Exit;
  end;

  { _app.asar e do Vencord; app.orig.asar sem o nosso gancho e estado que nao
    reconhecemos. Nos dois casos, nao mexemos no que nao e nosso. }
  if FileExists(Res + '\_app.asar') or FileExists(Orig) then
  begin
    ForeignApp := Res;
    Exit;
  end;

  { Gancho primeiro num temporario; depois as duas trocas de nome. Um
    desligamento no meio da copia deixa o Discord intacto. }
  if not FileCopy(Stub, Res + '\app.p2ps-tmp', False) then Exit;

  if not RenameFile(Asar, Orig) then
  begin
    DeleteFile(Res + '\app.p2ps-tmp');
    Exit;
  end;

  if RenameFile(Res + '\app.p2ps-tmp', Asar) then
    PatchedCount := PatchedCount + 1
  else
  begin
    RenameFile(Orig, Asar); { desfaz: Discord intacto }
    DeleteFile(Res + '\app.p2ps-tmp');
  end;
end;

{ ------------------------------------------------------------ atalho e logon }

const
  LAUNCHER = 'p2pshare-launcher.vbs';
  RUN_KEY = 'Software\Microsoft\Windows\CurrentVersion\Run';

function WscriptExe(): String;
begin
  Result := ExpandConstant('{sys}\wscript.exe');
end;

procedure RunLauncher(const Vbs, Args: String);
var
  ResultCode: Integer;
begin
  { Falha aqui nunca derruba a instalacao: atalho e logon sao extras. }
  Exec(WscriptExe(), '//B //Nologo "' + Vbs + '" ' + Args, '', SW_HIDE,
       ewWaitUntilTerminated, ResultCode);
end;

{ Copia o launcher para cada Discord instalado (fora da pasta do P2PShare:
  se ela sumir, o atalho continua abrindo o Discord), troca os atalhos e
  liga o reparo do gancho no logon do Windows. }
procedure InstallLauncher();
var
  I: Integer;
  Src, First: String;
begin
  Src := ExpandConstant('{app}\core\') + LAUNCHER;
  First := '';
  for I := 0 to 3 do
    if DirExists(ChannelDir(I)) then
      if FileCopy(Src, ChannelDir(I) + '\' + LAUNCHER, False) then
        if First = '' then First := ChannelDir(I) + '\' + LAUNCHER;
  if First = '' then Exit;

  RunLauncher(First, '/shortcuts install');
  RegWriteStringValue(HKEY_CURRENT_USER, RUN_KEY, 'P2PShare',
    '"' + WscriptExe() + '" //B //Nologo "' + First + '" /repair');
end;

procedure UninstallLauncher();
var
  I: Integer;
  Vbs: String;
  Restored: Boolean;
begin
  RegDeleteValue(HKEY_CURRENT_USER, RUN_KEY, 'P2PShare');
  Restored := False;
  for I := 0 to 3 do
  begin
    Vbs := ChannelDir(I) + '\' + LAUNCHER;
    if FileExists(Vbs) then
    begin
      if not Restored then
      begin
        RunLauncher(Vbs, '/shortcuts restore');
        Restored := True;
      end;
      DeleteFile(Vbs);
    end;
  end;
end;

procedure PatchDiscord();
var
  I: Integer;
  R: TFindRec;
begin
  PatchedCount := 0;
  ForeignApp := '';
  for I := 0 to 3 do
    if FindFirst(ChannelDir(I) + '\app-*', R) then
    begin
      try
        repeat
          if (R.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then
            PatchVersionDir(ChannelDir(I) + '\' + R.Name);
        until not FindNext(R);
      finally
        FindClose(R);
      end;
    end;
end;

procedure UnpatchDiscord();
var
  I: Integer;
  R: TFindRec;
  Res: String;
begin
  for I := 0 to 3 do
    if FindFirst(ChannelDir(I) + '\app-*', R) then
    begin
      try
        repeat
          Res := ChannelDir(I) + '\' + R.Name + '\resources';
          if FileExists(Res + '\app.orig.asar') and IsOurAsar(Res + '\app.asar') then
            if DeleteFile(Res + '\app.asar') then
              RenameFile(Res + '\app.orig.asar', Res + '\app.asar');
        until not FindNext(R);
      finally
        FindClose(R);
      end;
    end;
end;

{ ------------------------------------------------------------ Vencord }

{ O Vencord ocupa o mesmo ponto de entrada do Discord (resources). Remove
  pelo desinstalador oficial deles, preservando configuracoes e temas. }
function UninstallVencord(): Boolean;
var
  Cli: String;
  Branches: array[0..2] of String;
  I, ResultCode: Integer;
begin
  Result := False;

  if MsgBox('Feche o Discord completamente antes de continuar (inclusive pelo ' +
            'icone perto do relogio).' + #13#10 + #13#10 + 'Ja fechou?',
            mbConfirmation, MB_YESNO) = IDNO then
    Exit;

  try
    DownloadTemporaryFile('{#VcInstaller}', 'VencordInstallerCli.exe', '', nil);
  except
    MsgBox('Nao consegui baixar o desinstalador do Vencord.', mbError, MB_OK);
    Exit;
  end;

  Cli := ExpandConstant('{tmp}\VencordInstallerCli.exe');
  if not FileExists(Cli) then Exit;

  Branches[0] := 'stable';
  Branches[1] := 'ptb';
  Branches[2] := 'canary';

  { stdin de NUL: o CLI termina com "Press Enter to exit" e travaria escondido. }
  for I := 0 to 2 do
    Exec(ExpandConstant('{cmd}'),
         '/C ""' + Cli + '" -uninstall -branch ' + Branches[I] + '" < NUL',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  DelTree(ExpandConstant('{userappdata}\Vencord\dist'), True, True, True);
  Result := not VencordPresent();
end;

{ ------------------------------------------------------------ fluxo }

function InitializeSetup(): Boolean;
var
  Labels: TArrayOfString;
  Answer: Integer;
begin
  Result := True;

  if not DiscordInstalled() then
  begin
    MsgBox('Nao encontrei o Discord instalado neste usuario do Windows.' + #13#10 + #13#10 +
           'Instale o Discord (discord.com/download), abra uma vez e rode este ' +
           'instalador de novo.', mbError, MB_OK);
    Result := False;
    Exit;
  end;

  UseBd := BdInjected();
  InstalledVer := ReadInstalledVersion();

  if InstalledVer <> '' then
  begin
    Result := ConfirmReinstall();
    if not Result then Exit;
  end;

  if UseBd then
  begin
    MsgBox('Voce usa BetterDiscord, entao o P2PShare vai ser instalado como plugin ' +
           'do BetterDiscord, como sempre foi.' + #13#10 + #13#10 +
           'Nada e colocado dentro do Discord nesse caso: quem carrega o P2PShare ' +
           'e o proprio BetterDiscord.',
           mbInformation, MB_OK);
    Exit;
  end;

  if VencordPresent() then
  begin
    SetArrayLength(Labels, 2);
    Labels[0] := 'Remover o Vencord e continuar';
    Labels[1] := 'Cancelar';

    Answer := TaskDialogMsgBox(
      'O Vencord esta instalado nesta maquina',
      'O Vencord e o P2PShare usam o mesmo ponto de entrada do Discord, e os ' +
      'dois juntos ainda nao foram testados.' + #13#10 + #13#10 +
      'Posso remover o Vencord pelo desinstalador oficial dele. Configuracoes ' +
      'e temas do Vencord ficam salvos.',
      mbConfirmation, MB_OKCANCEL, Labels, 0);

    if Answer <> IDOK then
    begin
      Result := False;
      Exit;
    end;

    if not UninstallVencord() then
    begin
      MsgBox('Nao consegui remover o Vencord. Desinstale pelo instalador dele e ' +
             'rode este instalador de novo.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if StandaloneMode() and not CloseDiscord('para o P2PShare ser instalado') then
    Result := 'Feche o Discord (inclusive pelo icone perto do relogio) e rode o instalador de novo.';
end;

{ Liga o plugin na lista do BetterDiscord (modo BD). }
procedure EnableInChannel(const ChannelDataDir: String);
var
  Path, Content, Rest: String;
  Raw: AnsiString;
  Brace: Integer;
begin
  Path := ChannelDataDir + '\plugins.json';

  if not FileExists(Path) then
  begin
    SaveStringToFile(Path, '{' + #13#10 + '    "P2PShare": true' + #13#10 + '}', False);
    Exit;
  end;

  if not LoadStringFromFile(Path, Raw) then Exit;
  Content := Raw;

  if Pos('"P2PShare"', Content) > 0 then
  begin
    StringChangeEx(Content, '"P2PShare": false', '"P2PShare": true', True);
    StringChangeEx(Content, '"P2PShare":false', '"P2PShare":true', True);
    SaveStringToFile(Path, Content, False);
    Exit;
  end;

  Brace := Pos('{', Content);
  if Brace = 0 then Exit;

  Rest := Trim(Copy(Content, Brace + 1, Length(Content)));
  if Copy(Rest, 1, 1) = '}' then
    Content := '{' + #13#10 + '    "P2PShare": true' + #13#10 + '}'
  else
    Content := Copy(Content, 1, Brace) + #13#10 + '    "P2PShare": true,' +
               Copy(Content, Brace + 1, Length(Content));

  SaveStringToFile(Path, Content, False);
end;

procedure EnableBdPlugin();
var
  Data: String;
  Channels: array[0..3] of String;
  I: Integer;
begin
  Data := ExpandConstant('{userappdata}\BetterDiscord\data');
  Channels[0] := 'stable';
  Channels[1] := 'ptb';
  Channels[2] := 'canary';
  Channels[3] := 'development';
  for I := 0 to 3 do
    if DirExists(Data + '\' + Channels[I]) then
      EnableInChannel(Data + '\' + Channels[I]);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssInstall then
  begin
    { O componente de audio pode estar rodando e travar o arquivo. }
    Exec(ExpandConstant('{cmd}'), '/C taskkill /IM p2pshare-audio.exe /F >NUL 2>&1',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;

  if CurStep <> ssPostInstall then Exit;

  { Restos do desinstalador antigo, cujo registro agora aponta para ca. }
  DelTree(ExpandConstant('{userappdata}\BetterDiscord\P2PShare'), True, True, True);

  if UseBd then
  begin
    EnableBdPlugin();
    MsgBox('Plugin instalado e ligado no BetterDiscord.' + #13#10 + #13#10 +
           'Se o Discord estiver aberto, o BetterDiscord recarrega sozinho; senao, ' +
           'e so abrir o Discord.', mbInformation, MB_OK);
    Exit;
  end;

  PatchDiscord();

  if ForeignApp <> '' then
    MsgBox('Uma das instalacoes do Discord ja tem outra modificacao em:' + #13#10 +
           ForeignApp + #13#10 + #13#10 +
           'Nao mexi nela. O P2PShare nao vai carregar nessa instalacao.',
           mbError, MB_OK);

  if PatchedCount = 0 then
  begin
    MsgBox('Nao consegui ligar o P2PShare em nenhuma instalacao do Discord.' + #13#10 +
           'Os arquivos ficaram em ' + ExpandConstant('{app}') + '.', mbError, MB_OK);
    Exit;
  end;

  InstallLauncher();
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and StandaloneMode() then
    WizardForm.FinishedLabel.Caption :=
      'O P2PShare foi instalado, junto com o componente de audio (o som da ' +
      'transmissao ja funciona, sem baixar nada).' + #13#10 + #13#10 +
      'Abra o Discord e entre num canal de voz: o botao de tela do P2PShare aparece ' +
      'no painel de voz. Clique direito nele abre as configuracoes.' + #13#10 + #13#10 +
      'Se uma atualizacao do Discord fizer o P2PShare sumir, rode este instalador ' +
      'de novo: ele repara.';
end;

{ ------------------------------------------------------------ desinstalar }

function AnyPatched(): Boolean;
var
  I: Integer;
  R: TFindRec;
begin
  Result := False;
  for I := 0 to 3 do
    if FindFirst(ChannelDir(I) + '\app-*', R) then
    begin
      try
        repeat
          if IsOurAsar(ChannelDir(I) + '\' + R.Name + '\resources\app.asar') then
            Result := True;
        until Result or not FindNext(R);
      finally
        FindClose(R);
      end;
      if Result then Exit;
    end;
end;

function InitializeUninstall(): Boolean;
begin
  { Modo BetterDiscord ou gancho ja apagado por uma atualizacao do Discord:
    nada para renomear, nao precisa fechar o Discord. }
  Result := True;
  if not AnyPatched() then Exit;

  Result := CloseDiscord('para o P2PShare ser removido');
  if not Result then
    MsgBox('Feche o Discord e rode a desinstalacao de novo.', mbInformation, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    Exec(ExpandConstant('{cmd}'), '/C taskkill /IM p2pshare-audio.exe /F >NUL 2>&1',
         '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    { Atalhos de volta ao Discord direto antes de apagar o launcher. }
    UninstallLauncher();
    UnpatchDiscord();
  end;

  if CurUninstallStep = usPostUninstall then
  begin
    { Configuracao, diagnosticos e o que o plugin baixou sozinho. }
    DelTree(ExpandConstant('{userappdata}\P2PShare'), True, True, True);
    DeleteFile(ExpandConstant('{userappdata}\BetterDiscord\plugins\P2PShare.config.json'));
    DeleteFile(ExpandConstant('{userappdata}\BetterDiscord\plugins\p2pshare-debug.json'));
    DeleteFile(ExpandConstant('{userappdata}\BetterDiscord\plugins\p2pshare-audio-debug.json'));
    DeleteFile(ExpandConstant('{userappdata}\BetterDiscord\plugins\p2pshare-sounds-debug.json'));
    { O componente de audio grava ao lado de si: porta, token e log. }
    DeleteFile(ExpandConstant('{userappdata}\BetterDiscord\plugins\p2pshare-audio.port'));
    DeleteFile(ExpandConstant('{userappdata}\BetterDiscord\plugins\p2pshare-audio.token'));
    DeleteFile(ExpandConstant('{userappdata}\BetterDiscord\plugins\p2pshare-audio.log'));
    { Se o plugin baixou o componente sozinho, ele nao esta no log do Inno. }
    DeleteFile(ExpandConstant('{userappdata}\BetterDiscord\plugins\p2pshare-audio.exe'));

    if not UninstallSilent() then
      MsgBox('P2PShare removido.' + #13#10 + #13#10 +
             'O Discord voltou ao original e ja pode ser aberto.',
             mbInformation, MB_OK);
  end;
end;
