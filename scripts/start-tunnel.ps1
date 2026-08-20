# Public trycloudflare URL for the reader on port 3010. Detached from Grok.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root 'tunnel.log'
$exe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path $exe)) { throw "cloudflared not found at $exe" }
if (Test-Path $log) { Remove-Item $log -Force }
$wrapped = 'cmd.exe /c ""{0}" tunnel --url http://127.0.0.1:3010 --no-autoupdate >> "{1}" 2>&1"' -f $exe, $log
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $wrapped
    CurrentDirectory = $root
}
if ($result.ReturnValue -ne 0) {
    throw "Win32_Process.Create failed: $($result.ReturnValue)"
}
Write-Output "started pid=$($result.ProcessId) log=$log"
