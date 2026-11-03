' P2PShare - abre o Discord passando pelo P2PShare.
'
' Fica em %LocalAppData%\Discord\p2pshare-launcher.vbs (fora da pasta do
' P2PShare de proposito: se ela sumir, o atalho continua abrindo o Discord).
'
' REGRA: nada aqui pode impedir o Discord de abrir. Toda a parte do P2PShare
' roda com erro ignorado e com limite de tempo; abrir o Discord vem sempre
' por ultimo e tem plano B.
'
' Modos:
'   /launch <alvo-hex> <args-hex>   confere o gancho (<1 s) e abre o Discord
'                                   (alvo e argumentos originais do atalho)
'   /repair                         so confere o gancho (logon do Windows)
'   /shortcuts install|restore      troca/devolve os atalhos do Discord
'
' O gancho: %LocalAppData%\Discord\app-x.y.z\resources\app.asar pequeno do
' P2PShare, com o app.asar original do Discord renomeado para app.orig.asar.
' Quando o Discord se atualiza, a pasta app-x.y.z nova vem sem ele.

Option Explicit
On Error Resume Next

Const MARKER = "p2pshareLoader"
Const MAX_HOOK = 65536
Const BUDGET = 0.8 ' segundos para a parte do P2PShare no /launch

Dim fso, sh, started, budgetOn
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
started = Timer
budgetOn = False

Dim localApp, roamingApp, coreDir, stubPath, mainPath, logPath
localApp = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%")
roamingApp = sh.ExpandEnvironmentStrings("%APPDATA%")
coreDir = roamingApp & "\P2PShare\core"
stubPath = coreDir & "\app.asar"
mainPath = coreDir & "\main.js"
logPath = roamingApp & "\P2PShare\launcher.log"

Sub Log(msg)
    On Error Resume Next
    If Not fso.FolderExists(roamingApp & "\P2PShare") Then Exit Sub
    Dim f
    Set f = fso.OpenTextFile(logPath, 8, True)
    f.WriteLine Now & " " & msg
    f.Close
End Sub

Function OutOfTime()
    OutOfTime = False
    If Not budgetOn Then Exit Function
    Dim t
    t = Timer - started
    If t < 0 Then t = t + 86400 ' virada da meia-noite
    OutOfTime = (t > BUDGET)
End Function

' ---------------------------------------------------------------- gancho

' O gancho tem ~1 KB e carrega a marca; o app.asar do Discord, megabytes.
Function IsOurAsar(path)
    On Error Resume Next
    IsOurAsar = False
    If Not fso.FileExists(path) Then Exit Function
    If fso.GetFile(path).Size > MAX_HOOK Then Exit Function
    Dim st, txt
    Set st = CreateObject("ADODB.Stream")
    st.Type = 2
    st.Charset = "iso-8859-1"
    st.Open
    st.LoadFromFile path
    txt = st.ReadText
    st.Close
    If Err.Number <> 0 Then Err.Clear : Exit Function
    IsOurAsar = (InStr(txt, MARKER) > 0)
End Function

Function StubOk()
    StubOk = fso.FileExists(mainPath) And IsOurAsar(stubPath)
End Function

Sub FixVersionDir(vdir, haveStub)
    On Error Resume Next
    Dim res, asar, orig, tmp
    res = vdir & "\resources"
    asar = res & "\app.asar"
    orig = res & "\app.orig.asar"
    tmp = res & "\app.p2ps-tmp"

    ' _app.asar e do Vencord: nao mexemos no que nao e nosso.
    If fso.FileExists(res & "\_app.asar") Then Exit Sub

    If fso.FileExists(orig) Then
        ' Ja teve gancho. Gancho inteiro: nada a fazer.
        If IsOurAsar(asar) Then Exit Sub
        ' app.asar grande ao lado de um app.orig.asar: estado que nao
        ' reconhecemos; nao mexe.
        If fso.FileExists(asar) Then
            If fso.GetFile(asar).Size > MAX_HOOK Then Exit Sub
        End If
        ' Gancho quebrado (ausente, vazio ou corrompido): sem conserto o
        ' Discord nao abriria. Com o P2PShare instalado, recoloca o gancho;
        ' senao, devolve o original e o Discord abre puro.
        If haveStub Then
            fso.CopyFile stubPath, asar, True
            If Err.Number = 0 Then Log "gancho quebrado refeito em " & vdir : Exit Sub
            Err.Clear
        End If
        If fso.FileExists(asar) Then fso.DeleteFile asar, True
        Err.Clear
        fso.MoveFile orig, asar
        If Err.Number = 0 Then Log "gancho quebrado removido, Discord original devolvido em " & vdir
        Err.Clear
        Exit Sub
    End If

    ' Versao nova do Discord, ainda sem gancho.
    If Not haveStub Then Exit Sub
    If Not fso.FileExists(asar) Then Exit Sub
    If IsOurAsar(asar) Then Exit Sub ' gancho sem original: nao ha o que devolver

    ' Gancho primeiro num temporario; depois as duas trocas de nome.
    fso.CopyFile stubPath, tmp, True
    If Err.Number <> 0 Then Err.Clear : Exit Sub
    fso.MoveFile asar, orig
    If Err.Number <> 0 Then
        Err.Clear
        fso.DeleteFile tmp, True
        Err.Clear
        Exit Sub ' Discord rodando segura o arquivo: fica para a proxima
    End If
    fso.MoveFile tmp, asar
    If Err.Number <> 0 Then
        Err.Clear
        fso.MoveFile orig, asar ' desfaz: Discord intacto
        Err.Clear
        fso.DeleteFile tmp, True
        Err.Clear
        Exit Sub
    End If
    Log "gancho colocado em " & vdir
End Sub

Function IsVersionDirName(name)
    Dim re
    Set re = New RegExp
    re.Pattern = "^app-\d+(\.\d+)*$"
    IsVersionDirName = re.Test(name)
End Function

Sub Repair()
    On Error Resume Next
    Dim haveStub, channels, ch, dir, sub1
    haveStub = StubOk()
    channels = Array("Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment")
    For Each ch In channels
        dir = localApp & "\" & ch
        If fso.FolderExists(dir) Then
            For Each sub1 In fso.GetFolder(dir).SubFolders
                If OutOfTime() Then Log "tempo esgotado conferindo o gancho" : Exit Sub
                If IsVersionDirName(sub1.Name) Then FixVersionDir sub1.Path, haveStub
                Err.Clear
            Next
        End If
    Next
End Sub

' ---------------------------------------------------------------- texto <-> hex

Function ToHex(s)
    Dim i, out
    out = ""
    For i = 1 To Len(s)
        out = out & Right("0000" & Hex(AscW(Mid(s, i, 1)) And &HFFFF&), 4)
    Next
    ToHex = out
End Function

Function FromHex(h)
    On Error Resume Next
    Dim i, out
    out = ""
    For i = 1 To Len(h) Step 4
        out = out & ChrW(CLng("&H" & Mid(h, i, 4)))
    Next
    If Err.Number <> 0 Then Err.Clear : out = ""
    FromHex = out
End Function

' ---------------------------------------------------------------- abrir

Sub OpenDiscord(target, args)
    On Error Resume Next
    Dim myDir, exe
    If target <> "" And fso.FileExists(target) Then
        Err.Clear
        sh.Run """" & target & """ " & args, 1, False
        If Err.Number = 0 Then Log "Discord aberto: " & target : Exit Sub
        Err.Clear
    End If

    ' Plano B: o lancador do Discord da pasta onde este arquivo esta.
    myDir = fso.GetParentFolderName(WScript.ScriptFullName)
    For Each exe In Array(myDir & "\Update.exe", myDir & "\Discord.exe")
        If fso.FileExists(exe) Then
            Err.Clear
            sh.Run """" & exe & """ --processStart Discord.exe", 1, False
            If Err.Number = 0 Then Log "Discord aberto pelo plano B: " & exe : Exit Sub
        End If
    Next
    Log "nao achei como abrir o Discord"
End Sub

' ---------------------------------------------------------------- atalhos

Function ChannelOfTarget(target)
    ' "C:\...\AppData\Local\DiscordPTB\DiscordPTB.exe" -> "...\DiscordPTB"
    ChannelOfTarget = ""
    Dim parent, name
    parent = fso.GetParentFolderName(target)
    If LCase(fso.GetParentFolderName(parent)) <> LCase(localApp) Then Exit Function
    name = LCase(fso.GetFileName(parent))
    If name = "discord" Or name = "discordptb" Or name = "discordcanary" Or name = "discorddevelopment" Then
        ChannelOfTarget = parent
    End If
End Function

Function WscriptExe()
    WscriptExe = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
End Function

Sub DoShortcut(path, mode)
    On Error Resume Next
    Dim lnk, target, args, chDir, vbs, parts
    Set lnk = sh.CreateShortcut(path)
    If Err.Number <> 0 Then Err.Clear : Exit Sub
    target = lnk.TargetPath
    args = lnk.Arguments

    If mode = "install" Then
        If InStr(LCase(args), "--processstart") = 0 Then Exit Sub
        chDir = ChannelOfTarget(target)
        If chDir = "" Then Exit Sub
        vbs = chDir & "\p2pshare-launcher.vbs"
        If Not fso.FileExists(vbs) Then Exit Sub
        lnk.TargetPath = WscriptExe()
        lnk.Arguments = "//B //Nologo """ & vbs & """ /launch " & ToHex(target) & " " & ToHex(args)
        lnk.Save
        If Err.Number = 0 Then Log "atalho trocado: " & path
    Else
        If LCase(fso.GetFileName(target)) <> "wscript.exe" Then Exit Sub
        If InStr(LCase(args), "p2pshare-launcher.vbs") = 0 Then Exit Sub
        parts = Split(Trim(Mid(args, InStr(LCase(args), "/launch ") + 8)), " ")
        If UBound(parts) < 0 Then Exit Sub
        target = FromHex(parts(0))
        args = ""
        If UBound(parts) >= 1 Then args = FromHex(parts(1))
        If target = "" Then Exit Sub
        lnk.TargetPath = target
        lnk.Arguments = args
        lnk.Save
        If Err.Number = 0 Then Log "atalho devolvido: " & path
    End If
    Err.Clear
End Sub

Sub ScanFolder(folderPath, mode, depth)
    On Error Resume Next
    If Not fso.FolderExists(folderPath) Then Exit Sub
    Dim f, d
    For Each f In fso.GetFolder(folderPath).Files
        If LCase(fso.GetExtensionName(f.Name)) = "lnk" Then
            If InStr(LCase(f.Name), "discord") > 0 Then DoShortcut f.Path, mode
        End If
    Next
    If depth > 0 Then
        For Each d In fso.GetFolder(folderPath).SubFolders
            ScanFolder d.Path, mode, depth - 1
        Next
    End If
End Sub

Sub Shortcuts(mode)
    On Error Resume Next
    ScanFolder sh.SpecialFolders("Desktop"), mode, 0
    ScanFolder sh.SpecialFolders("Programs"), mode, 1
    ScanFolder roamingApp & "\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar", mode, 0
    ' Inicializacao automatica do Discord (HKCU\...\Run\Discord)
    Dim runKey, v, chDir, vbs, exePart, argPart, q
    runKey = "HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Discord"
    Err.Clear
    v = sh.RegRead(runKey)
    If Err.Number <> 0 Then Err.Clear : Exit Sub
    If mode = "install" Then
        If Left(v, 1) <> """" Then Exit Sub
        q = InStr(2, v, """")
        If q = 0 Then Exit Sub
        exePart = Mid(v, 2, q - 2)
        argPart = Trim(Mid(v, q + 1))
        If InStr(LCase(argPart), "--processstart") = 0 Then Exit Sub
        chDir = ChannelOfTarget(exePart)
        If chDir = "" Then Exit Sub
        vbs = chDir & "\p2pshare-launcher.vbs"
        If Not fso.FileExists(vbs) Then Exit Sub
        sh.RegWrite runKey, """" & WscriptExe() & """ //B //Nologo """ & vbs & """ /launch " & ToHex(exePart) & " " & ToHex(argPart), "REG_SZ"
        If Err.Number = 0 Then Log "inicializacao automatica do Discord passando pelo P2PShare"
    Else
        If InStr(LCase(v), "p2pshare-launcher.vbs") = 0 Then Exit Sub
        Dim parts
        parts = Split(Trim(Mid(v, InStr(LCase(v), "/launch ") + 8)), " ")
        If UBound(parts) < 1 Then Exit Sub
        exePart = FromHex(parts(0))
        argPart = FromHex(parts(1))
        If exePart = "" Then Exit Sub
        sh.RegWrite runKey, """" & exePart & """ " & argPart, "REG_SZ"
        If Err.Number = 0 Then Log "inicializacao automatica do Discord devolvida"
    End If
    Err.Clear
End Sub

' ---------------------------------------------------------------- principal

Dim mode, a1, a2
mode = ""
If WScript.Arguments.Count > 0 Then mode = LCase(WScript.Arguments(0))

Select Case mode
    Case "/repair"
        Repair
    Case "/shortcuts"
        If WScript.Arguments.Count > 1 Then Shortcuts LCase(WScript.Arguments(1))
    Case Else
        ' /launch (ou sem argumentos): P2PShare com limite de tempo, Discord sempre.
        a1 = "" : a2 = ""
        If WScript.Arguments.Count > 1 Then a1 = FromHex(WScript.Arguments(1))
        If WScript.Arguments.Count > 2 Then a2 = FromHex(WScript.Arguments(2))
        budgetOn = True
        Repair
        Err.Clear
        OpenDiscord a1, a2
End Select
