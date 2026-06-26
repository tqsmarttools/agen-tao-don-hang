param(
  [int]$Limit = 10,
  [int]$IntervalSeconds = 5,
  [switch]$RunOnce
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $repoRoot "data\scheduled-worker-last.log"
$nodePath = (Get-Command node -ErrorAction Stop).Source
$scriptPath = Join-Path $repoRoot "scripts\run-phone-order-scheduled-cycle.mjs"
$mutexName = "Local\TQSmarttoolsPhoneOrderWorkerLoop"
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$hasHandle = $false

try {
  $hasHandle = $mutex.WaitOne(0, $false)
} catch [System.Threading.AbandonedMutexException] {
  $hasHandle = $true
}

if (-not $hasHandle) {
  Add-Content -LiteralPath $logPath -Value ("[{0}] Worker loop skipped because another loop instance is already running." -f (Get-Date -Format o))
  exit 0
}

try {
  do {
    Add-Content -LiteralPath $logPath -Value ("[{0}] Starting scheduled cycle limit={1}" -f (Get-Date -Format o), $Limit)

    Push-Location $repoRoot
    try {
      & $nodePath $scriptPath --limit $Limit --skip-lock *>> $logPath
    } catch {
      Add-Content -LiteralPath $logPath -Value ("[{0}] Scheduled cycle failed: {1}" -f (Get-Date -Format o), $_.Exception.Message)
    } finally {
      Pop-Location
      Add-Content -LiteralPath $logPath -Value ("[{0}] Finished scheduled cycle" -f (Get-Date -Format o))
    }

    if (-not $RunOnce) {
      Start-Sleep -Seconds $IntervalSeconds
    }
  }
  while (-not $RunOnce)
} finally {
  if ($hasHandle) {
    $mutex.ReleaseMutex()
  }

  $mutex.Dispose()
}
