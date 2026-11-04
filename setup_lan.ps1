# 집 안 사진 전송은 지정한 내부 IP와 집 안 네트워크에만 허용합니다.
param([string]$LanIp='192.168.75.181',[string[]]$Networks=@('192.168.75.0/24','192.168.45.0/24'))
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$parsed=[Net.IPAddress]::Parse($LanIp)
if ($parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or -not ($LanIp -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)')) { throw '집 안 IPv4 주소를 사용해 주세요.' }
@{ip=$LanIp;url="https://${LanIp}:8443";networks=@($Networks)+@('127.0.0.0/8')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'data/mobile-lan.json') -Encoding utf8
$program=Join-Path $root 'data/tools/caddy-2.11.7/caddy.exe'
$old=Get-NetFirewallApplicationFilter | Where-Object { $_.Program -eq $program } | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.Name -ne 'ButterflyArchive-LAN-8443' }
$old | Select-Object Name,Enabled | Export-Clixml -LiteralPath (Join-Path $root '.tmp/mobile-previous-firewall.xml')
$old | Disable-NetFirewallRule | Out-Null
if (Get-NetFirewallRule -Name 'ButterflyArchive-LAN-8443' -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -Name 'ButterflyArchive-LAN-8443' }
New-NetFirewallRule -Name 'ButterflyArchive-LAN-8443' -DisplayName 'Butterfly Archive home photo transfer' -Direction Inbound -Action Allow -Program $program -Protocol TCP -LocalPort 8443 -LocalAddress $LanIp -RemoteAddress $Networks -Profile Any | Out-Null
Write-Output "집 안 전송 주소: https://${LanIp}:8443"
Write-Output '80·443 포트포워딩은 집 안 사진 전송에 필요하지 않습니다.'
