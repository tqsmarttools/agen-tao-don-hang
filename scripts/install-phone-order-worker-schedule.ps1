param(
  [string]$TaskName = "TQSmarttools Phone Order Worker",
  [int]$Minutes = 30,
  [int]$Limit = 10
)

$ErrorActionPreference = "Stop"

$wrapperPath = Join-Path $PSScriptRoot "run-phone-order-scheduled-cycle.ps1"
$actionArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$wrapperPath`" -Limit $Limit"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs

$startAt = (Get-Date).AddMinutes(1)
$trigger = New-ScheduledTaskTrigger -Once -At $startAt
$trigger.Repetition = New-ScheduledTaskRepetitionSettingsSet `
  -Interval (New-TimeSpan -Minutes $Minutes) `
  -Duration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Polls phone-order inbox and creates Sapo orders on a schedule." `
  -Force | Out-Null

Write-Output "Installed scheduled task: $TaskName (every $Minutes minutes, limit=$Limit)"
