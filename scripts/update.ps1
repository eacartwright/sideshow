#Requires -RunAsAdministrator
<#
  Updates the always-on sideshow server to the latest main and restarts it.
  Run from an admin PowerShell in the server's clone (C:\Apps\sideshow):
    .\scripts\update.ps1
  install.ps1 runs this with -NoPull for the first start.
#>
param([switch]$NoPull)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

function Invoke-Step($what, [scriptblock]$cmd) {
  Write-Host "== $what" -ForegroundColor Cyan
  & $cmd
  if ($LASTEXITCODE) { throw "$what failed (exit code $LASTEXITCODE)" }
}

if (-not $NoPull) { Invoke-Step "git pull" { git pull --ff-only } }

# The task was called fieldtime before the rename (2026-10); install.ps1 replaces it.
$task = "sideshow"
if (-not (Get-ScheduledTask -TaskName sideshow -ErrorAction SilentlyContinue)) {
  $task = "fieldtime"
  Write-Host "Still the old 'fieldtime' task: run scripts\install.ps1 once to rename it." -ForegroundColor Yellow
}

# Stop first: the running server holds files in node_modules (esbuild.exe), so npm ci fails
# with EPERM while it's up.
Write-Host "== stop" -ForegroundColor Cyan
Stop-ScheduledTask -TaskName $task
# Stopping the task ends run.cmd but can leave its node child running; end the whole tree.
Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" |
  Where-Object { $_.CommandLine -like "*$root\scripts\run.cmd*" } |
  ForEach-Object { taskkill /T /F /PID $_.ProcessId | Out-Null }

try {
  Invoke-Step "npm ci" { npm ci --no-audit --no-fund }
  Invoke-Step "build" { npm run build }
} finally {
  # Start again even if a step failed, so a bad update doesn't leave the app down.
  Write-Host "== start" -ForegroundColor Cyan
  Start-ScheduledTask -TaskName $task
}

$port = (Get-Content .env | Where-Object { $_ -match "^PORT=" }) -replace "^PORT=", ""
if (-not $port) {
  # Without PORT the server falls back to 8787, but the tunnel points at the port install.ps1
  # set (8081 on the mini PC), so the site would be down. Usually .env was replaced by a copy
  # of the dev PC's, which has no PORT or backup folder.
  Write-Host "No PORT in .env, so the server is on its default 8787 and the public site can't reach it." -ForegroundColor Red
  Write-Host "Run install.ps1 again with -Port and -BackupDir (docs\runbook.md, Settings) to put them back." -ForegroundColor Red
  exit 1
}
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    # 127.0.0.1, not localhost: on the mini PC, localhost can resolve to IPv6, where Caddy listens.
    $h = Invoke-RestMethod "http://127.0.0.1:$port/api/health"
    Write-Host "sideshow is up on http://127.0.0.1:$port (rev $($h.rev), last backup: $($h.lastBackup))" -ForegroundColor Green
    exit 0
  } catch {}
}
Write-Host "sideshow did not answer on port $port. See $root\data\server.log" -ForegroundColor Red
exit 1
