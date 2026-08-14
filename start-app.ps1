$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tools = Join-Path $root 'tools'
$node = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$cf = Join-Path $tools 'cloudflared.exe'
$log = Join-Path $tools 'cloudflared.log'
$errLog = Join-Path $tools 'cloudflared.err.log'

Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -like '*server.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -WindowStyle Hidden
Remove-Item -LiteralPath $log,$errLog -ErrorAction SilentlyContinue
Start-Process -FilePath $cf -ArgumentList @('tunnel','--url','http://localhost:3000','--no-autoupdate') -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errLog

Start-Sleep -Seconds 15

$content = ''
if (Test-Path -LiteralPath $log) {
  $content += Get-Content -Raw -LiteralPath $log
}
if (Test-Path -LiteralPath $errLog) {
  $content += Get-Content -Raw -LiteralPath $errLog
}
$match = [regex]::Match($content, 'https://[a-z0-9-]+\.trycloudflare\.com')

if ($match.Success) {
  Write-Host ''
  Write-Host 'Device App started'
  Write-Host "Public URL: $($match.Value)"
  Write-Host 'Demo accounts: admin/admin123 or staff/staff123'
} else {
  Write-Host 'Starting... URL not found yet, check tools\cloudflared.err.log'
}
