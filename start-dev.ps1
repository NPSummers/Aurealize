$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

npx kill-port 3000 5173

$apiPort = 3000
$webPort = 5173

if (Get-NetTCPConnection -LocalPort $apiPort -State Listen -ErrorAction SilentlyContinue) {
  $apiPort = 3002
}

if (Get-NetTCPConnection -LocalPort $webPort -State Listen -ErrorAction SilentlyContinue) {
  $webPort = 5174
}

$env:PORT = "$apiPort"

$api = Start-Process `
  -FilePath bun `
  -ArgumentList "run", "dev:server" `
  -WorkingDirectory $PSScriptRoot `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput "api.log" `
  -RedirectStandardError "api.err"

Start-Sleep -Seconds 2

$web = Start-Process `
  -FilePath bun `
  -ArgumentList "run", "dev:client", "--", "--port", "$webPort" `
  -WorkingDirectory $PSScriptRoot `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput "web.log" `
  -RedirectStandardError "web.err"

@"
API_PID=$($api.Id)
WEB_PID=$($web.Id)
API_PORT=$apiPort
WEB_PORT=$webPort
"@ | Set-Content ".dev-server.pids"

Write-Host ""
Write-Host "Aurealize Cards is starting."
Write-Host "Open: http://localhost:$webPort"
Write-Host "API:  http://localhost:$apiPort"
Write-Host ""
Write-Host "Logs: api.log, api.err, web.log, web.err"
Write-Host "PIDs: .dev-server.pids"
Write-Host ""
