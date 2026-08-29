$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root "release"

# Only kill app binaries, never the current shell/terminal.
Get-Process -Name "electron","PiShift","pishift" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue

$me = $PID
$procs = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $me -and
  $_.Name -match '^(electron|PiShift|pishift|OpenConsole)\.exe$' -and
  $_.CommandLine -and (
    $_.CommandLine -like "*\release\win-unpacked*" -or
    $_.CommandLine -like "*\PiShift\out\*" -or
    $_.CommandLine -like "*PiShift.exe*"
  )
}
foreach ($p in $procs) {
  Write-Host "Killing $($p.ProcessId) $($p.Name)"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

$targets = @(
  (Join-Path $release "win-unpacked"),
  (Join-Path $release "win-unpacked.tmp")
)

foreach ($t in $targets) {
  if (-not (Test-Path -LiteralPath $t)) { continue }
  try {
    cmd /c "rmdir /s /q `"$t`""
    if (Test-Path -LiteralPath $t) { throw "still exists" }
    Write-Host "Removed $t"
  } catch {
    $stamp = Get-Date -Format "yyyyMMddHHmmss"
    $leaf = (Split-Path $t -Leaf) + "-stale-" + $stamp
    try {
      Rename-Item -LiteralPath $t -NewName $leaf -Force
      Write-Host "Renamed locked dir to $leaf"
    } catch {
      Write-Host "Still locked: $t"
      Write-Host $_
      exit 2
    }
  }
}

Get-ChildItem $release | Select-Object Name
exit 0
