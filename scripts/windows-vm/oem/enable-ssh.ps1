$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
} catch {
    Write-Output "OpenSSH capability failed ($_), installing the MSI from GitHub"
    $release = Invoke-RestMethod https://api.github.com/repos/PowerShell/Win32-OpenSSH/releases/latest
    $asset = $release.assets | Where-Object name -Like 'OpenSSH-Win64-*.msi' | Select-Object -First 1
    $msi = Join-Path $env:TEMP $asset.name
    Invoke-WebRequest $asset.browser_download_url -OutFile $msi
    Start-Process msiexec.exe -ArgumentList '/i', $msi, '/qn' -Wait
}

Set-Service sshd -StartupType Automatic
Start-Service sshd
if (-not (Get-NetFirewallRule -Name claudio-sshd -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name claudio-sshd -DisplayName 'OpenSSH (Claudio test VM)' -Protocol TCP -LocalPort 22 -Action Allow -Direction Inbound | Out-Null
}
New-ItemProperty -Path HKLM:\SOFTWARE\OpenSSH -Name DefaultShell -Value "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force | Out-Null

$keys = 'C:\ProgramData\ssh\administrators_authorized_keys'
Copy-Item C:\OEM\authorized_keys $keys -Force
icacls.exe $keys /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null

powercfg.exe /change standby-timeout-ac 0
powercfg.exe /change monitor-timeout-ac 0
Write-Output 'ssh ready'
