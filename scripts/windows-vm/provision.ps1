$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$downloads = 'C:\claudio-vm\downloads'
New-Item -ItemType Directory -Force $downloads | Out-Null

function Add-MachinePath([string]$dir) {
    $path = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    if (($path -split ';') -notcontains $dir) {
        [Environment]::SetEnvironmentVariable('Path', "$path;$dir", 'Machine')
    }
}

# Rust links with the MSVC linker, so the C++ Build Tools are required before rustup.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVcTools = (Test-Path $vswhere) -and (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (-not $hasVcTools) {
    Write-Output 'Installing Visual Studio Build Tools (C++), this takes a while'
    Invoke-WebRequest https://aka.ms/vs/17/release/vs_BuildTools.exe -OutFile "$downloads\vs_BuildTools.exe"
    $process = Start-Process "$downloads\vs_BuildTools.exe" -Wait -PassThru -ArgumentList @(
        '--quiet', '--wait', '--norestart', '--nocache',
        '--add', 'Microsoft.VisualStudio.Workload.VCTools', '--includeRecommended')
    if ($process.ExitCode -notin 0, 3010) {
        throw "Build Tools installer failed with exit code $($process.ExitCode)"
    }
}

# Machine-wide homes so the SSH administrator and the desktop user share one toolchain.
$rustupHome = 'C:\rust\rustup'
$cargoHome = 'C:\rust\cargo'
[Environment]::SetEnvironmentVariable('RUSTUP_HOME', $rustupHome, 'Machine')
[Environment]::SetEnvironmentVariable('CARGO_HOME', $cargoHome, 'Machine')
if (-not (Test-Path "$cargoHome\bin\cargo.exe")) {
    Write-Output 'Installing Rust'
    Invoke-WebRequest https://win.rustup.rs/x86_64 -OutFile "$downloads\rustup-init.exe"
    $env:RUSTUP_HOME = $rustupHome
    $env:CARGO_HOME = $cargoHome
    & "$downloads\rustup-init.exe" -y --default-toolchain stable --profile minimal --no-modify-path
    if ($LASTEXITCODE -ne 0) { throw "rustup-init failed with exit code $LASTEXITCODE" }
}
Add-MachinePath "$cargoHome\bin"

if (-not (Get-Command node -ErrorAction SilentlyContinue) -and -not (Test-Path 'C:\Program Files\nodejs\node.exe')) {
    $releases = Invoke-RestMethod https://nodejs.org/dist/index.json
    $lts = ($releases | ForEach-Object { $_ } | Where-Object { $_.lts } | Select-Object -First 1).version
    Write-Output "Installing Node.js $lts"
    $msi = "$downloads\node-$lts-x64.msi"
    Invoke-WebRequest "https://nodejs.org/dist/$lts/node-$lts-x64.msi" -OutFile $msi
    Start-Process msiexec.exe -ArgumentList '/i', $msi, '/qn' -Wait
}
Add-MachinePath 'C:\Program Files\nodejs'

# npm and vp ship .ps1 shims. This process runs with -ExecutionPolicy Bypass, so PowerShell reports the
# machine setting as overridden even though it was applied.
try { Set-ExecutionPolicy RemoteSigned -Scope LocalMachine -Force } catch [System.Security.SecurityException] { }

$vpVersion = '1.4.0'
if (-not (Test-Path "$env:USERPROFILE\.vite-plus") -and -not (Get-Command vp -ErrorAction SilentlyContinue)) {
    Write-Output "Installing Vite+ $vpVersion"
    $env:VP_VERSION = $vpVersion
    Invoke-RestMethod https://vite.plus/ps1 | Invoke-Expression
}

# The dockur unattended install switches UAC off. Claudio's installer and elevation paths only behave
# as they do for real users with UAC on, so turn it back on. It takes effect after a reboot.
$uac = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
if ((Get-ItemProperty $uac).EnableLUA -ne 1) {
    Set-ItemProperty $uac -Name EnableLUA -Value 1 -Type DWord
    Set-ItemProperty $uac -Name ConsentPromptBehaviorAdmin -Value 5 -Type DWord
    Set-ItemProperty $uac -Name PromptOnSecureDesktop -Value 1 -Type DWord
    New-Item -ItemType File -Force C:\claudio-vm\reboot-required | Out-Null
}

New-Item -ItemType Directory -Force C:\claudio | Out-Null
Write-Output 'provisioned'
