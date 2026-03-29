param(
  [string]$Engine = $(if ($env:AGENT_BROWSER_ENGINE) { $env:AGENT_BROWSER_ENGINE } else { 'lightpanda' }),
  [string]$LightpandaBin = $(if ($env:LIGHTPANDA_BIN) { $env:LIGHTPANDA_BIN } else { '/root/lightpanda/lightpanda' }),
  [switch]$AllowChromeFallback
)

$ErrorActionPreference = 'Stop'

$targetUrl = 'https://inmobiliariaiparralde.com/'
$sessionBase = "iparralde-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputJson = Join-Path $scriptDir 'results.json'
$outputTable = Join-Path $scriptDir 'results_table.md'
$outputSteps = Join-Path $scriptDir 'agent_browser_steps.log'

$stepLog = New-Object System.Collections.Generic.List[string]

function Quote-StepArg([string]$Value) {
  if ($null -eq $Value) { return "''" }
  if ($Value -match '^[A-Za-z0-9_./:@-]+$') { return $Value }
  return "'" + ($Value -replace "'", "''") + "'"
}

function Get-CommonArgs([string]$EngineName, [string]$SessionName) {
  $args = @('--session', $SessionName, '--engine', $EngineName, '--json')
  if ($EngineName -eq 'lightpanda' -and $LightpandaBin) {
    $args += @('--executable-path', $LightpandaBin)
  }
  return $args
}

function Invoke-AgentBrowser([string]$EngineName, [string]$SessionName, [string[]]$CmdArgs) {
  $allArgs = @()
  $allArgs += Get-CommonArgs -EngineName $EngineName -SessionName $SessionName
  $allArgs += $CmdArgs

  $stepLine = 'agent-browser ' + (($allArgs | ForEach-Object { Quote-StepArg $_ }) -join ' ')
  $stepLog.Add($stepLine) | Out-Null

  $raw = & agent-browser @allArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $stepLine"
  }

  $rawText = ($raw | Out-String).Trim()
  $jsonLine = ($rawText -split "`r?`n" | Where-Object { $_.Trim().StartsWith('{') -and $_.Trim().EndsWith('}') } | Select-Object -Last 1)
  if (-not $jsonLine) {
    throw "Non-JSON output from command: $stepLine`n$rawText"
  }

  $payload = $jsonLine | ConvertFrom-Json
  if (-not $payload.success) {
    throw "Command failed: $stepLine`n$($payload.error)"
  }

  return $payload.data
}

function Invoke-EvalJson([string]$EngineName, [string]$SessionName, [string]$JsCode) {
  $data = Invoke-AgentBrowser -EngineName $EngineName -SessionName $SessionName -CmdArgs @('eval', $JsCode)
  if (-not $data.result) { return $null }
  return ($data.result | ConvertFrom-Json)
}

function Get-StableId([string]$DetailUrl) {
  if ([string]::IsNullOrWhiteSpace($DetailUrl)) { return '' }
  $m = [regex]::Match($DetailUrl, '/(\d+)/?$')
  if ($m.Success) { return $m.Groups[1].Value }
  return [BitConverter]::ToString(
    [System.Security.Cryptography.SHA1]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($DetailUrl))
  ).Replace('-', '').ToLower().Substring(0, 16)
}

function New-RowObject($Raw) {
  $detailUrl = [string]$Raw.detailUrl
  return [pscustomobject]@{
    title = ([string]$Raw.title).Trim()
    price = ([string]$Raw.price).Trim()
    location = ([string]$Raw.location).Trim()
    detailUrl = $detailUrl.Trim()
    scrapingTimestamp = ([string]$Raw.scrapingTimestamp).Trim()
    stableId = Get-StableId -DetailUrl $detailUrl
  }
}

function Scrape-Listings([string]$EngineName, [string]$SessionName) {
  Invoke-AgentBrowser -EngineName $EngineName -SessionName $SessionName -CmdArgs @('open', $targetUrl) | Out-Null
  Invoke-AgentBrowser -EngineName $EngineName -SessionName $SessionName -CmdArgs @('wait', '--load', 'networkidle') | Out-Null

  Invoke-AgentBrowser -EngineName $EngineName -SessionName $SessionName -CmdArgs @('select', "form.findus select[name='tipoInmueble[]']", 'piso') | Out-Null
  Invoke-AgentBrowser -EngineName $EngineName -SessionName $SessionName -CmdArgs @('select', "form.findus select[name='municipio[]']", 'Hendaye') | Out-Null
  Invoke-AgentBrowser -EngineName $EngineName -SessionName $SessionName -CmdArgs @('click', 'form.findus button[type="submit"]') | Out-Null

  Invoke-AgentBrowser -EngineName $EngineName -SessionName $SessionName -CmdArgs @('wait', '--load', 'networkidle') | Out-Null
  Invoke-AgentBrowser -EngineName $EngineName -SessionName $SessionName -CmdArgs @('wait', '#easyPaginate-1 .property-list-list') | Out-Null

  $scrapePageJs = @'
JSON.stringify((() => {
  const timestamp = new Date().toISOString();
  const cards = Array.from(document.querySelectorAll('#easyPaginate-1 .property-list-list'));
  return cards
    .filter((card) => {
      const style = window.getComputedStyle(card);
      return style.display !== 'none' && card.offsetParent !== null;
    })
    .map((card) => {
      const info = card.querySelector('.property-list-list-info');
      const detailUrl = card.querySelector('a.wi')?.href?.trim() || '';
      const title = card.querySelector('a.wi img')?.alt?.trim() || info?.querySelector('h3')?.textContent?.trim() || '';
      const price = info?.querySelector('.price')?.textContent?.trim() || '';
      const text = info?.textContent || '';
      const locMatch = text.match(/\d{5}\s+[^\n,]+,\s*(ES|FR)/i);
      const location = locMatch ? locMatch[0].trim() : '';
      return { title, price, location, detailUrl, scrapingTimestamp: timestamp };
    });
})())
'@

  $paginationJs = @'
JSON.stringify(Array.from(document.querySelectorAll('.easyPaginateNav a.page'))
  .map((a) => a.getAttribute('rel'))
  .filter(Boolean))
'@

  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  $rows = New-Object System.Collections.Generic.List[object]

  $addRows = {
    param($Items)
    foreach ($item in @($Items)) {
      $row = New-RowObject $item
      $key = if ($row.detailUrl) { $row.detailUrl } else { $row.stableId }
      if ([string]::IsNullOrWhiteSpace($key)) { continue }
      if ($seen.Add($key)) {
        $rows.Add($row) | Out-Null
      }
    }
  }

  & $addRows (Invoke-EvalJson -EngineName $EngineName -SessionName $SessionName -JsCode $scrapePageJs)
  $rels = Invoke-EvalJson -EngineName $EngineName -SessionName $SessionName -JsCode $paginationJs

  foreach ($rel in @($rels)) {
    Invoke-AgentBrowser -EngineName $EngineName -SessionName $SessionName -CmdArgs @('click', ".easyPaginateNav a.page[rel='$rel']") | Out-Null
    Invoke-AgentBrowser -EngineName $EngineName -SessionName $SessionName -CmdArgs @('wait', '250') | Out-Null
    & $addRows (Invoke-EvalJson -EngineName $EngineName -SessionName $SessionName -JsCode $scrapePageJs)
  }

  return ,$rows
}

function Close-Session([string]$EngineName, [string]$SessionName) {
  try {
    Invoke-AgentBrowser -EngineName $EngineName -SessionName $SessionName -CmdArgs @('close') | Out-Null
  } catch {
    # Ignore close cleanup errors.
  }
}

function Save-Artifacts($Results) {
  $json = $Results | ConvertTo-Json -Depth 6
  Set-Content -Path $outputJson -Value $json -Encoding utf8

  $tableLines = @(
    '| # | Title | Price | Location | Stable ID | Detail URL | Timestamp |',
    '|---:|---|---|---|---|---|---|'
  )

  $index = 1
  foreach ($r in $Results) {
    $title = ([string]$r.title).Replace('|', '\|').Replace("`n", ' ').Trim()
    $price = ([string]$r.price).Replace('|', '\|').Replace("`n", ' ').Trim()
    $location = ([string]$r.location).Replace('|', '\|').Replace("`n", ' ').Trim()
    $stableId = ([string]$r.stableId).Replace('|', '\|').Trim()
    $detailUrl = ([string]$r.detailUrl).Replace('|', '\|').Trim()
    $timestamp = ([string]$r.scrapingTimestamp).Replace('|', '\|').Trim()
    $tableLines += "| $index | $title | $price | $location | $stableId | $detailUrl | $timestamp |"
    $index++
  }

  Set-Content -Path $outputTable -Value ($tableLines -join "`n") -Encoding utf8
  Set-Content -Path $outputSteps -Value ($stepLog -join "`n") -Encoding utf8
}

$selectedEngine = $Engine
$selectedSession = $sessionBase
$results = $null

try {
  $results = Scrape-Listings -EngineName $selectedEngine -SessionName $selectedSession
} catch {
  if ($selectedEngine -eq 'lightpanda' -and $AllowChromeFallback.IsPresent) {
    $stepLog.Add("# Lightpanda failed; retrying with chrome because -AllowChromeFallback was provided") | Out-Null
    $selectedEngine = 'chrome'
    $selectedSession = "$sessionBase-chrome"
    $results = Scrape-Listings -EngineName $selectedEngine -SessionName $selectedSession
  } else {
    throw
  }
} finally {
  Close-Session -EngineName $selectedEngine -SessionName $selectedSession
}

Save-Artifacts -Results $results

$summary = [pscustomobject]@{
  engineUsed = $selectedEngine
  count = @($results).Count
  outputJson = $outputJson
  outputTable = $outputTable
  outputSteps = $outputSteps
}

$summary | ConvertTo-Json -Depth 4