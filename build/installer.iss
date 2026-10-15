; Clauditor installer (Inno Setup 6). Built by scripts/installer.mjs after `electron-builder --dir`.
;
; Per-user install without administrator rights: %LOCALAPPDATA%\Programs\Clauditor.
; English by default, Indonesian when Windows runs in Indonesian.
; The app was called "Tempa" before: that older install (an NSIS package) is removed on the way;
; its settings are carried over by the app itself on first start.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppName "Clauditor"
#define AppExe "Clauditor.exe"
#define AppUserModelId "id.rivaldi.clauditor"
#define Root ".."

[Setup]
AppId={{982E9F3B-50FD-4E76-A069-E605A86A873B}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Rivaldi
AppComments=Code editor for Claude Code, connected to Claude desktop
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Setup
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
DisableWelcomePage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#Root}\dist
OutputBaseFilename={#AppName}-Setup-{#AppVersion}
SetupIconFile={#Root}\build\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
ShowLanguageDialog=no
UsePreviousTasks=yes
ChangesAssociations=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "id"; MessagesFile: "Indonesian.isl"

[CustomMessages]
en.ContextMenu=Add "Open with Clauditor" to the folder right-click menu
id.ContextMenu=Tambahkan "Buka dengan Clauditor" ke menu klik-kanan folder
en.Integration=Windows integration:
id.Integration=Integrasi Windows:
en.OpenWith=Open with Clauditor
id.OpenWith=Buka dengan Clauditor
en.RemovingTempa=Removing Tempa (the previous name of Clauditor)...
id.RemovingTempa=Menghapus Tempa (nama lama Clauditor)...

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "contextmenu"; Description: "{cm:ContextMenu}"; GroupDescription: "{cm:Integration}"

[InstallDelete]
; Electron and its locale packs change between versions: start from a clean program folder
Type: filesandordirs; Name: "{app}\locales"
Type: filesandordirs; Name: "{app}\resources"

[Files]
Source: "{#Root}\dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Root}\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "{#Root}\THIRD-PARTY-NOTICES.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "{#AppUserModelId}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "{#AppUserModelId}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\Directory\shell\Clauditor"; ValueType: string; ValueName: ""; ValueData: "{cm:OpenWith}"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\Directory\shell\Clauditor"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe}"; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\Directory\shell\Clauditor\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%V"""; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\Clauditor"; ValueType: string; ValueName: ""; ValueData: "{cm:OpenWith}"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\Clauditor"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe}"; Tasks: contextmenu
Root: HKCU; Subkey: "Software\Classes\Directory\Background\shell\Clauditor\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%V"""; Tasks: contextmenu

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[Code]
const
  TempaUninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\536c3258-63d8-52e3-bc0e-40f6277bba77';

// The previous release ("Tempa", an NSIS package) installed elsewhere; remove it so the
// shortcuts, Apps entry and folder context menu are not duplicated.
procedure RemoveTempa();
var
  Uninstaller, Dir: String;
  Code: Integer;
begin
  if not RegQueryStringValue(HKCU, TempaUninstallKey, 'InstallLocation', Dir) then
    Dir := ExpandConstant('{localappdata}\Programs\tempa');
  Uninstaller := AddBackslash(Dir) + 'Uninstall Tempa.exe';
  if not FileExists(Uninstaller) then exit;
  WizardForm.StatusLabel.Caption := CustomMessage('RemovingTempa');
  // _?= runs the uninstaller in place and waits for it
  Exec(Uninstaller, '/currentuser /S _?=' + Dir, '', SW_HIDE, ewWaitUntilTerminated, Code);
  DeleteFile(Uninstaller);
  RemoveDir(Dir);
  RegDeleteKeyIncludingSubkeys(HKCU, TempaUninstallKey);
  RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\Directory\shell\Tempa');
  RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\Directory\Background\shell\Tempa');
  DeleteFile(ExpandConstant('{userprograms}\Tempa.lnk'));
  DeleteFile(ExpandConstant('{userdesktop}\Tempa.lnk'));
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then RemoveTempa();
end;
