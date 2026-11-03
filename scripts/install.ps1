#Requires -RunAsAdministrator
<#
  Sets this PC up to run sideshow around the clock:
    - writes .env (port, backup folder)
    - registers the "sideshow" scheduled task: starts at boot, runs whether or not anyone is
      signed in, and restarts the server if it exits (scripts\run.cmd)
    - allows the port through Windows Firewall on private networks (LAN / Tailscale)
    - builds the app and starts it
  Run once from an admin PowerShell in the server's clone (C:\Apps\sideshow):
    .\scripts\install.ps1 [-Port 8081] [-BackupDir <folder>]
  Safe to run again to change settings. A setting you leave out keeps its value from .env;
  on a first install it defaults to port 8081 and backups in OneDrive (if signed in).
  The mini PC uses: -Port 8081 -BackupDir \\evnas\Junk\Tech\DBBackups\sideshow
#>
param(
  [int]$Port,
  # Daily database copies; keep them off this machine (NAS, OneDrive). "" = data\backups.
  [string]$BackupDir
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# Only PORT and SIDESHOW_BACKUP_DIR are ours; keep every other line (CW_*, PROFILE). FIELDTIME_BACKUP_DIR
# is the same setting from before the rename: read it, and write it back under the new name.
$envLines = @()
$current = @{}
if (Test-Path "$root\.env") {
  foreach ($line in Get-Content "$root\.env") {
    if ($line -match "^(PORT|SIDESHOW_BACKUP_DIR|FIELDTIME_BACKUP_DIR)=(.*)$") { $current[$Matches[1]] = $Matches[2] }
    else { $envLines += $line }
  }
}
if (-not $PSBoundParameters.ContainsKey("Port")) {
  $Port = if ($current.PORT) { [int]$current.PORT } else { 8081 }
}
if (-not $PSBoundParameters.ContainsKey("BackupDir")) {
  $BackupDir = if ($current.ContainsKey("SIDESHOW_BACKUP_DIR")) { $current.SIDESHOW_BACKUP_DIR }
    elseif ($current.ContainsKey("FIELDTIME_BACKUP_DIR")) { $current.FIELDTIME_BACKUP_DIR }
    elseif ($env:OneDrive) { Join-Path $env:OneDrive "Backups\sideshow" } else { "" }
}
$envLines += "PORT=$Port"
if ($BackupDir) { $envLines += "SIDESHOW_BACKUP_DIR=$BackupDir" }
# No byte-order mark: Node would read it as part of the first key.
[IO.File]::WriteAllLines("$root\.env", $envLines, (New-Object Text.UTF8Encoding $false))
Write-Host "== .env" -ForegroundColor Cyan
$envLines | Where-Object { $_ -match "^(PORT|SIDESHOW_BACKUP_DIR)=" } | ForEach-Object { Write-Host "   $_" }

Write-Host "== scheduled task 'sideshow'" -ForegroundColor Cyan
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$root\scripts\run.cmd`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName sideshow -Action $action -Trigger $trigger -Principal $principal `
  -Settings $settings -Description "sideshow server ($root)" -Force | Out-Null

Write-Host "== firewall (port $Port, private networks)" -ForegroundColor Cyan
Get-NetFirewallRule -DisplayName "sideshow" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName "sideshow" -Direction Inbound -Protocol TCP -LocalPort $Port `
  -Profile Private -Action Allow | Out-Null

& "$PSScriptRoot\update.ps1" -NoPull
exit $LASTEXITCODE
