Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$logsDir = Join-Path $PSScriptRoot 'logs'

if (-not (Test-Path -Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

function Quote-ProcessArg {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  return '"' + ($Value -replace '"', '\\"') + '"'
}

function Invoke-TimedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,

    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [hashtable]$Environment = @{},

    [int]$TimeoutMs = 600000
  )

  $safeName = ($Name.ToLowerInvariant() -replace '[^a-z0-9]+', '_').Trim('_')
  $stdoutPath = Join-Path $logsDir "$safeName.stdout.log"
  $stderrPath = Join-Path $logsDir "$safeName.stderr.log"

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Arguments = ($Arguments | ForEach-Object { Quote-ProcessArg -Value $_ }) -join ' '

  foreach ($key in $Environment.Keys) {
    $psi.EnvironmentVariables[[string]$key] = [string]$Environment[$key]
  }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi

  $stdout = ''
  $stderr = ''
  $runError = $null
  $runStatus = 'ok'
  $notes = ''
  $totalSeconds = 0.0

  try {
    $elapsed = Measure-Command {
      $null = $process.Start()
      if (-not $process.WaitForExit($TimeoutMs)) {
        try {
          $process.Kill()
        } catch {
          # Ignore cleanup failures after timeout.
        }
        throw "Timed out after $TimeoutMs ms"
      }
      $stdout = $process.StandardOutput.ReadToEnd()
      $stderr = $process.StandardError.ReadToEnd()
      $process.WaitForExit()
    }
    $totalSeconds = $elapsed.TotalSeconds
  } catch {
    $runError = $_
    if ($runError.Exception.Message -like 'Timed out after*') {
      $runStatus = 'timeout'
    } else {
      $runStatus = 'failed-to-start'
    }
    $notes = $runError.Exception.Message
    if (-not $stderr) {
      $stderr = $_.Exception.Message
    }
  }

  Set-Content -Path $stdoutPath -Value $stdout -Encoding utf8
  Set-Content -Path $stderrPath -Value $stderr -Encoding utf8

  if ($runError) {
    $envText = ($Environment.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }) -join ' '
    $commandText = if ($envText) { "$envText $FilePath $($Arguments -join ' ')" } else { "$FilePath $($Arguments -join ' ')" }
    return [pscustomobject]@{
      name = $Name
      command = $commandText
      exitCode = -1
      userSeconds = [double]::NaN
      systemSeconds = [double]::NaN
      cpuSeconds = [double]::NaN
      totalSeconds = [Math]::Round($totalSeconds, 3)
      status = $runStatus
      notes = $notes
      stdoutLog = $stdoutPath
      stderrLog = $stderrPath
    }
  }

  $envText = ($Environment.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }) -join ' '
  $commandText = if ($envText) { "$envText $FilePath $($Arguments -join ' ')" } else { "$FilePath $($Arguments -join ' ')" }

  return [pscustomobject]@{
    name = $Name
    command = $commandText
    exitCode = $process.ExitCode
    userSeconds = [Math]::Round($process.UserProcessorTime.TotalSeconds, 3)
    systemSeconds = [Math]::Round($process.PrivilegedProcessorTime.TotalSeconds, 3)
    cpuSeconds = [Math]::Round($process.TotalProcessorTime.TotalSeconds, 3)
    totalSeconds = [Math]::Round($totalSeconds, 3)
    status = if ($process.ExitCode -eq 0) { 'ok' } else { 'failed' }
    notes = if ($process.ExitCode -eq 0) { '' } else { "Exit code $($process.ExitCode)" }
    stdoutLog = $stdoutPath
    stderrLog = $stderrPath
  }
}

$runs = @(
  @{
    Name = 'playwright MCP + browser extension'
    WorkingDirectory = Join-Path $repoRoot 'exercise1'
    FilePath = 'node'
    Arguments = @('scrape_iparralde.js')
    Environment = @{}
  },
  @{
    Name = 'agent-browser'
    WorkingDirectory = Join-Path $repoRoot 'exercise3'
    FilePath = 'node'
    Arguments = @('scrape_iparralde_agent_browser.js')
    Environment = @{}
  },
  @{
    Name = 'agent-browser + lightpanda'
    WorkingDirectory = Join-Path $repoRoot 'exercise4'
    FilePath = 'node'
    Arguments = @('scrape_iparralde_agent_browser_lightpanda.js')
    Environment = @{
      AGENT_BROWSER_ENGINE = 'lightpanda'
      ALLOW_CHROME_FALLBACK = 'true'
    }
  }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($run in $runs) {
  Write-Host "Running: $($run.Name)"
  $result = Invoke-TimedProcess -Name $run.Name -WorkingDirectory $run.WorkingDirectory -FilePath $run.FilePath -Arguments $run.Arguments -Environment $run.Environment
  $results.Add($result) | Out-Null
}

$jsonPath = Join-Path $PSScriptRoot 'timings.json'
$results | ConvertTo-Json -Depth 4 | Set-Content -Path $jsonPath -Encoding utf8

$lines = @(
  '# Exercise 5 - Execution Time Measurements',
  '',
  "Measured with PowerShell Measure-Command + process CPU timers.",
  '',
  '| Combination | Command | user (s) | system (s) | cpu (s) | total (s) | status |',
  '|---|---|---:|---:|---:|---:|---|'
)

foreach ($r in $results) {
  $userText = if ([double]::IsNaN([double]$r.userSeconds)) { 'n/a' } else { ('{0:N3}' -f $r.userSeconds) }
  $systemText = if ([double]::IsNaN([double]$r.systemSeconds)) { 'n/a' } else { ('{0:N3}' -f $r.systemSeconds) }
  $cpuText = if ([double]::IsNaN([double]$r.cpuSeconds)) { 'n/a' } else { ('{0:N3}' -f $r.cpuSeconds) }
  $totalText = if ([double]::IsNaN([double]$r.totalSeconds)) { 'n/a' } else { ('{0:N3}' -f $r.totalSeconds) }
  $cmdText = [string]$r.command
  $statusText = [string]$r.status
  if ($r.notes) {
    $statusText = "$statusText ($($r.notes))"
  }
  $lines += "| $($r.name) | $cmdText | $userText | $systemText | $cpuText | $totalText | $statusText |"
}

$lines += ''
$lines += '## Logs'

foreach ($r in $results) {
  $stdoutRel = "logs/$(([System.IO.Path]::GetFileName([string]$r.stdoutLog)))"
  $stderrRel = "logs/$(([System.IO.Path]::GetFileName([string]$r.stderrLog)))"
  $lines += "- $($r.name): stdout=$stdoutRel, stderr=$stderrRel"
}

$mdPath = Join-Path $PSScriptRoot 'results_table.md'
Set-Content -Path $mdPath -Value ($lines -join "`n") -Encoding utf8

Write-Host "Wrote: $mdPath"
Write-Host "Wrote: $jsonPath"