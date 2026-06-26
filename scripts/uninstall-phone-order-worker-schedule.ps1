param(
  [string]$TaskName = "TQSmarttools Phone Order Worker"
)

$ErrorActionPreference = "Stop"

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
Write-Output "Removed scheduled task: $TaskName"
