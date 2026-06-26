param(
  [int]$Limit = 10
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $repoRoot "data\scheduled-worker-last.log"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$scriptPath = Join-Path $repoRoot "scripts\run-phone-order-scheduled-cycle.mjs"

Add-Content -LiteralPath $logPath -Value ("[{0}] Starting scheduled cycle limit={1}" -f (Get-Date -Format o), $Limit)

Push-Location $repoRoot
try {
  & $nodePath $scriptPath --limit $Limit *>> $logPath
} finally {
  Pop-Location
  Add-Content -LiteralPath $logPath -Value ("[{0}] Finished scheduled cycle" -f (Get-Date -Format o))
}
