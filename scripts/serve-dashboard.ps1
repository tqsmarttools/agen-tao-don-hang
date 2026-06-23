$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $PSScriptRoot
$port = 4173

Set-Location $workspaceRoot

try {
  $pythonVersion = python --version 2>$null
} catch {
  throw "Python is required to serve the dashboard locally."
}

Write-Output "Serving dashboard at http://127.0.0.1:$port/apps/dashboard/"
python -m http.server $port
