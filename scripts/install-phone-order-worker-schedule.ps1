param(
  [string]$TaskName = "TQSmarttools-Phone-Order-Worker",
  [int]$IntervalSeconds = 5,
  [int]$Limit = 10
)

$ErrorActionPreference = "Stop"

$wrapperPath = Join-Path $PSScriptRoot "run-phone-order-scheduled-cycle.ps1"
$tempXmlPath = Join-Path $env:TEMP "tq-phone-order-worker-task.xml"
$startBoundary = (Get-Date).AddMinutes(1).ToString("s")
$startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$startupCmdPath = Join-Path $startupDir "TQSmarttools-Phone-Order-Worker.cmd"
$workerArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$wrapperPath`" -Limit $Limit -IntervalSeconds $IntervalSeconds"

function Start-WorkerLoop {
  Start-Process -FilePath "powershell.exe" -ArgumentList $workerArguments -WindowStyle Hidden
}

function Install-StartupLauncher {
  $startupContent = "@echo off`r`npowershell.exe $workerArguments`r`n"
  Set-Content -LiteralPath $startupCmdPath -Value $startupContent -Encoding ASCII
  Start-WorkerLoop
  Write-Output "Installed startup launcher: $startupCmdPath (continuous loop every $IntervalSeconds seconds, limit=$Limit)"
}

$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Runs the phone-order worker loop and polls the inbox continuously.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
    <TimeTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <DisallowStartOnRemoteAppSession>false</DisallowStartOnRemoteAppSession>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$wrapperPath" -Limit $Limit -IntervalSeconds $IntervalSeconds</Arguments>
      <WorkingDirectory>$([System.Security.SecurityElement]::Escape((Split-Path -Parent $PSScriptRoot)))</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

[System.IO.File]::WriteAllText($tempXmlPath, $taskXml, [System.Text.Encoding]::Unicode)

try {
  $process = Start-Process `
    -FilePath "schtasks.exe" `
    -ArgumentList @("/Create", "/TN", $TaskName, "/XML", $tempXmlPath, "/F") `
    -NoNewWindow `
    -Wait `
    -PassThru

  if ($process.ExitCode -ne 0) {
    throw "schtasks.exe /Create failed with exit code $($process.ExitCode)."
  }

  Start-ScheduledTask -TaskName $TaskName

  Write-Output "Installed scheduled task: $TaskName (continuous loop every $IntervalSeconds seconds, limit=$Limit)"
} catch {
  Install-StartupLauncher
} finally {
  Remove-Item $tempXmlPath -Force -ErrorAction SilentlyContinue
}
