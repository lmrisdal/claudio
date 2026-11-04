param(
    [Parameter(Mandatory)][string]$Command,
    [string]$WorkingDirectory = 'C:\claudio',
    [int]$TimeoutSeconds = 1800
)

# Over SSH an administrator gets a full token and no desktop, so UAC never prompts and error 740
# never happens. A scheduled task in the signed-in session runs with the normal filtered token, the
# same way Claudio runs for a real user.
$ErrorActionPreference = 'Stop'
$id = [guid]::NewGuid().ToString('N').Substring(0, 8)
$dir = 'C:\claudio-vm\desktop-runs'
New-Item -ItemType Directory -Force $dir | Out-Null
$log = "$dir\$id.log"
$exitFile = "$dir\$id.exit"
$script = "$dir\$id.cmd"
$inner = "$dir\$id-command.cmd"
Set-Content $inner -Encoding ASCII -Value @('@echo off', "cd /d `"$WorkingDirectory`"", $Command)
Set-Content $script -Encoding ASCII -Value @(
    '@echo off',
    "cmd /c `"$inner`" > `"$log`" 2>&1",
    "echo %ERRORLEVEL% > `"$exitFile`"")

$task = "claudio-desktop-$id"
$action = New-ScheduledTaskAction -Execute cmd.exe -Argument "/c `"$script`""
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Force -ErrorAction Stop | Out-Null
try {
    Start-ScheduledTask -TaskName $task -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while (-not (Test-Path $exitFile)) {
        if ((Get-Date) -gt $deadline) {
            Write-Output "timed out after $TimeoutSeconds s; log so far:"
            if (Test-Path $log) { Get-Content $log }
            exit 124
        }
        Start-Sleep -Milliseconds 500
    }

    if (Test-Path $log) { Get-Content $log }
    exit [int](Get-Content $exitFile).Trim()
} finally {
    Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
}
