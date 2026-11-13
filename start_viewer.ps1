# 현재 Windows 사용자만 해독 가능한 자격으로 제한 계정의 서버를 시작합니다.
param([switch]$Https, [switch]$Shutdown)
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$config=Get-Content -LiteralPath (Join-Path $projectRoot 'data/viewer-deployment.json') -Raw | ConvertFrom-Json
$root=[IO.Path]::GetFullPath($config.root)
if ($root -ne (Join-Path $env:ProgramData 'ButterflyArchiveViewer')) { throw '조회 실행 경로를 확인해 주세요.' }
if ($Https) {
    $file=Join-Path $root 'runtime/caddy.exe'
    $arguments='run --config "'+(Join-Path $root 'Caddyfile')+'" --adapter caddyfile'
    $log='https'
} else {
    $file=Join-Path $root 'runtime/python.exe'
    $arguments='-I "'+(Join-Path $root 'viewer_server.py')+'"'
    $log='viewer'
}
$existing=Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $file -and $_.CommandLine -and $_.CommandLine.TrimEnd() -eq ('"'+$file+'" '+$arguments) }
if ($Shutdown) {
    $credential=Import-Clixml -LiteralPath (Join-Path $projectRoot 'data/viewer-credential.xml')
    $expected=('"'+$file+'" '+$arguments).Replace("'", "''")
    $command=@'
$ErrorActionPreference='Stop'
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.TrimEnd() -eq '__EXPECTED__' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop }
'@
    $command=$command.Replace('__EXPECTED__', $expected)
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $process=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList "-NoProfile -NonInteractive -EncodedCommand $encoded" -Credential $credential -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw '조회 서버 프로세스를 종료하지 못했습니다.' }
    exit 0
}
$credential=Import-Clixml -LiteralPath (Join-Path $projectRoot 'data/viewer-credential.xml')
if ($existing) { Write-Output '조회 서버가 이미 실행 중입니다.'; exit 0 }
Start-Process -FilePath $file -ArgumentList $arguments -Credential $credential -WorkingDirectory $root -WindowStyle Hidden -LoadUserProfile -RedirectStandardOutput (Join-Path $root "logs/$log-stdout.log") -RedirectStandardError (Join-Path $root "logs/$log-stderr.log") | Out-Null
Write-Output '제한 계정으로 실행을 요청했습니다.'
