; Moshe for Windows: an installer for one person, which needs no administrator.
; It copies what dotnet publish made (build\Moshe) to %LOCALAPPDATA%\Programs\Moshe
; and puts Moshe in the Start menu. Made by windows\build.ps1 and the Windows workflow:
;
;   iscc /DVersion=0.1.0 windows\installer.iss
;
; Uninstalling leaves the library alone, and the settings in %LOCALAPPDATA%\Moshe.

#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef Source
  #define Source "..\build\Moshe"
#endif

[Setup]
AppId={{6F0B8E2A-6B3D-4C1F-9E57-2A8D4C7B1E35}
AppName=Moshe
AppVersion={#Version}
AppVerName=Moshe {#Version}
AppPublisher=franz-rosenzweig
AppPublisherURL=https://github.com/franz-rosenzweig/moshe
AppSupportURL=https://github.com/franz-rosenzweig/moshe/blob/master/docs/windows.md
DefaultDirName={localappdata}\Programs\Moshe
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\build\out
OutputBaseFilename=Moshe-{#Version}-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#Source}\Assets\Moshe.ico
UninstallDisplayIcon={app}\Moshe.exe
UninstallDisplayName=Moshe
CloseApplications=yes

[Tasks]
Name: desktopicon; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; an update leaves none of the old web app's files behind
Type: filesandordirs; Name: "{app}\web"

[Files]
Source: "{#Source}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Moshe"; Filename: "{app}\Moshe.exe"
Name: "{autodesktop}\Moshe"; Filename: "{app}\Moshe.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Moshe.exe"; Description: "{cm:LaunchProgram,Moshe}"; Flags: nowait postinstall skipifsilent
