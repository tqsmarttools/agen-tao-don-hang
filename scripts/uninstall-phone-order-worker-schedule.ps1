param(
  [string]$TaskName = "TQSmarttools-Phone-Order-Worker"
)

$ErrorActionPreference = "Stop"
$quotedTaskName = '"' + $TaskName + '"'
$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$startupCmdPath = Join-Path $startupDir "TQSmarttools-Phone-Order-Worker.cmd"

$process = Start-Process `
  -FilePath "schtasks.exe" `
  -ArgumentList @("/Delete", "/TN", $quotedTaskName, "/F") `
  -NoNewWindow `
  -Wait `
  -PassThru

if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 1) {
  throw "schtasks.exe /Delete failed with exit code $($process.ExitCode)."
}

Remove-Item -LiteralPath $startupCmdPath -Force -ErrorAction SilentlyContinue

Write-Output "Removed worker auto-start for task: $TaskName"
