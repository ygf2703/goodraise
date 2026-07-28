$root = Split-Path -Parent $PSScriptRoot
$pythonExe = $env:YELLOW_DASHBOARD_PYTHON_EXE

if (-not $pythonExe) {
  $pythonExe = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
}

if (-not (Test-Path $pythonExe)) {
  throw "Python runtime not found. Set YELLOW_DASHBOARD_PYTHON_EXE to a valid python.exe path."
}

& $pythonExe (Join-Path $PSScriptRoot "run_dashboard_server.py") @args
