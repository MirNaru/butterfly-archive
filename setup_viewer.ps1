# 원본 프로젝트를 읽을 수 없는 Windows 계정과 조회 서버 실행 환경을 구성합니다.
$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$viewerRoot=Join-Path $env:ProgramData 'ButterflyArchiveViewer'
$accountName='ButterflyArchiveView'
$taskViewer='ButterflyArchive-Viewer'
$taskHttps='ButterflyArchive-HTTPS'
$currentIdentity=[Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($currentIdentity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '관리자 권한으로 실행해 주세요.' }
$existingAccount=Get-LocalUser -Name $accountName -ErrorAction SilentlyContinue
if ($existingAccount) {
    $marker=Join-Path $projectRoot 'data/viewer-deployment.json'
    if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).sid -ne $existingAccount.SID.Value) { throw '다른 기존 계정을 덮어쓰지 않습니다.' }
}
$python=Join-Path $projectRoot 'backend/.venv/Scripts/python.exe'
$pythonBase=(& $python -c 'import sys; print(sys.base_prefix)').Trim()
if (-not (Test-Path -LiteralPath (Join-Path $pythonBase 'python.exe'))) { throw 'Python 기본 실행 파일을 확인하지 못했습니다.' }
$privateDb=(& $python -c "import sys,json;sys.path.insert(0,'backend');from app.database import database_path;print(json.dumps(str(database_path().resolve()),ensure_ascii=True))") | ConvertFrom-Json
$randomBytes=New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($randomBytes)
$password=[Convert]::ToBase64String($randomBytes)+'!aA7'
$securePassword=ConvertTo-SecureString $password -AsPlainText -Force
if ($existingAccount) { Set-LocalUser -Name $accountName -Password $securePassword; $account=$existingAccount }
else { $account=New-LocalUser -Name $accountName -Password $securePassword -PasswordNeverExpires -UserMayNotChangePassword -Description 'Butterfly Archive read-only viewer' }
$sid=$account.SID.Value
$standardUsers=Get-LocalGroup -SID 'S-1-5-32-545'
if (-not (Get-LocalGroupMember -Group $standardUsers | Where-Object { $_.SID -eq $account.SID })) { Add-LocalGroupMember -Group $standardUsers -Member $accountName }
New-Item -ItemType Directory -Force -Path $viewerRoot | Out-Null
$acl=Get-Acl -LiteralPath $viewerRoot
$acl.SetAccessRuleProtection($true,$false)
foreach ($entry in @(@($currentIdentity.User,'FullControl'),@([Security.Principal.SecurityIdentifier]::new('S-1-5-18'),'FullControl'),@([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'),'FullControl'),@($account.SID,'ReadAndExecute'))) {
    $rule=[Security.AccessControl.FileSystemAccessRule]::new($entry[0],$entry[1],'ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $viewerRoot -AclObject $acl
foreach ($folder in @('runtime','web','auth','snapshots','logs','tls')) { New-Item -ItemType Directory -Force -Path (Join-Path $viewerRoot $folder) | Out-Null }
foreach ($folder in @('auth','logs','tls')) {
    & icacls (Join-Path $viewerRoot $folder) /grant:r "*${sid}:(OI)(CI)(M)" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '조회 서버 저장 폴더 권한 설정 실패' }
}
# 설치된 공식 Python의 실행 파일·표준 라이브러리만 복사합니다. 사용자 site-packages는 포함하지 않습니다.
foreach ($file in Get-ChildItem -LiteralPath $pythonBase -File | Where-Object { $_.Extension -in @('.exe','.dll','.zip','._pth') }) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $viewerRoot 'runtime') }
New-Item -ItemType Directory -Force -Path (Join-Path $viewerRoot 'runtime/Lib') | Out-Null
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $pythonBase 'Lib') | Where-Object { $_.Name -notin @('site-packages','__pycache__','test','idlelib','tkinter','ensurepip') }) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $viewerRoot 'runtime/Lib') -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $pythonBase 'DLLs') -Destination (Join-Path $viewerRoot 'runtime') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'viewer_server.py') -Destination (Join-Path $viewerRoot 'viewer_server.py')
Copy-Item -Path (Join-Path $projectRoot 'viewer_web/*') -Destination (Join-Path $viewerRoot 'web')
Copy-Item -LiteralPath (Join-Path $projectRoot 'data/tools/caddy-2.11.7/caddy.exe') -Destination (Join-Path $viewerRoot 'runtime/caddy.exe')
Copy-Item -LiteralPath (Join-Path $projectRoot 'Caddyfile') -Destination (Join-Path $viewerRoot 'Caddyfile')
$env:BUTTERFLY_VIEWER_ROOT=$viewerRoot
& $python -c 'import os;from pathlib import Path;import viewer_server;viewer_server.initialize_auth(Path(os.environ["BUTTERFLY_VIEWER_ROOT"]))'
if ($LASTEXITCODE -ne 0) { throw '조회 인증 저장소 준비 실패' }
$config=@{root=$viewerRoot;account=$accountName;sid=$sid;viewer_task=$taskViewer;https_task=$taskHttps}
$config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'data/viewer-deployment.json') -Encoding utf8
$privateKey=Join-Path $projectRoot 'data/pc-access.key'
if (-not (Test-Path -LiteralPath $privateKey)) { & $python -c 'import sys;sys.path.insert(0,"backend");from app.local_access import key_path;import secrets;key_path().write_text(secrets.token_urlsafe(48),encoding="ascii")' }
# 변경 전 ACL을 보존하고 새 계정에만 거부 규칙을 더합니다.
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.tmp/viewer-project-acl.xml'))) { Get-Acl -LiteralPath $projectRoot | Export-Clixml -LiteralPath (Join-Path $projectRoot '.tmp/viewer-project-acl.xml') }
Get-Acl -LiteralPath $privateDb | Export-Clixml -LiteralPath (Join-Path $projectRoot '.tmp/viewer-db-acl.xml')
& icacls $projectRoot /deny "*${sid}:(OI)(CI)(F)" /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw '프로젝트 접근 제한 실패' }
& icacls $privateDb /deny "*${sid}:(F)" /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw '원본 DB 접근 제한 실패' }
# 재시작 자격은 현재 Windows 사용자만 풀 수 있는 DPAPI 형식으로 보관합니다.
$name='{0}\{1}' -f $env:COMPUTERNAME,$accountName
$credential=[Management.Automation.PSCredential]::new($name,$securePassword)
$credential | Export-Clixml -LiteralPath (Join-Path $projectRoot 'data/viewer-credential.xml')
$password=$null;$securePassword=$null
foreach ($taskName in @($taskViewer,$taskHttps)) {
    $oldTask=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($oldTask -and $oldTask.Principal.UserId -like '*ButterflyArchiveView') { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
}
& (Join-Path $projectRoot 'start_viewer.ps1')
Write-Output '조회 전용 계정·파일 권한을 구성했습니다. 외부 HTTPS는 아직 시작하지 않았습니다.'
