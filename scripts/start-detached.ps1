# Start the Next.js reader detached from any Grok session.
# Port 3010: 3000 is Proton Mail MCP on this machine.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'dev-server.log'
$node = (Get-Command node).Source
$next = Join-Path $root 'node_modules\next\dist\bin\next'
if (-not (Test-Path $next)) { throw "Next.js is not installed at $next" }

$cmd = '"{0}" "{1}" dev --turbopack --port 3010 --hostname 0.0.0.0' -f $node, $next
# Redirect via cmd so the server has a log and is not a Grok child.
$wrapped = 'cmd.exe /c "cd /d {0} && {1} >> {2} 2>&1"' -f $root, $cmd, $log
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $wrapped
    CurrentDirectory = $root
}
if ($result.ReturnValue -ne 0) {
    throw "Win32_Process.Create failed: $($result.ReturnValue)"
}
Write-Output "started pid=$($result.ProcessId) port=3010 log=$log"
