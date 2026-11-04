"""검증한 Caddy와 별도 모바일 서버를 숨김 창으로 실행합니다."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.request import Request, ProxyHandler, build_opener

ROOT = Path(__file__).resolve().parent
LOGS = ROOT / '.tmp'
CADDY = ROOT / 'data/tools/caddy-2.11.7/caddy.exe'
import json
CONFIG=ROOT/'data/mobile-lan.json'
def configuration():
    if not CONFIG.is_file():raise RuntimeError('집 안 전송 서버의 내부 IP·허용 네트워크 설정이 없습니다.')
    return json.loads(CONFIG.read_text(encoding='utf-8-sig'))


def mobile_ready():
    try:
        request = Request('http://127.0.0.1:8001/', headers={'Host':configuration()['url'].removeprefix('https://'),'X-Forwarded-Proto':'https'})
        with build_opener(ProxyHandler({})).open(request, timeout=3) as response:
            return 'Butterfly Archive' in response.read().decode('utf-8')
    except OSError:
        return False


def occupied(port,host='127.0.0.1'):
    with socket.socket() as sock:
        return sock.connect_ex((host,port)) == 0


def start(name, command, environment):
    with (LOGS / f'mobile-{name}.log').open('ab') as log:
        return subprocess.Popen(command,cwd=ROOT,env=environment,stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=subprocess.CREATE_NO_WINDOW)


def main():
    LOGS.mkdir(exist_ok=True)
    if not CADDY.is_file():
        raise RuntimeError('Caddy 공식 Windows 배포본이 없습니다. README의 모바일 실행 안내를 확인해 주세요.')
    environment = os.environ.copy()
    config=configuration()
    environment['BUTTERFLY_LAN_IP']=config['ip']
    environment['BUTTERFLY_LAN_TLS_STORAGE']=(ROOT/'data/mobile-lan-tls').as_posix()
    subprocess.run([str(CADDY),'validate','--config',str(ROOT/'Caddy.lan'),'--adapter','caddyfile'],env=environment,cwd=ROOT,check=True)
    if not mobile_ready():
        if occupied(8001):
            raise RuntimeError('8001 포트가 다른 프로그램에서 사용 중입니다. 해당 프로그램은 종료하지 않았습니다.')
        start('backend',[str(ROOT/'backend/.venv/Scripts/python.exe'),'-m','uvicorn','app.mobile_server:app','--app-dir','backend','--host','127.0.0.1','--port','8001','--proxy-headers','--forwarded-allow-ips','127.0.0.1','--no-access-log','--limit-concurrency','16','--timeout-keep-alive','10'],environment)
        for _ in range(60):
            if mobile_ready():
                break
            time.sleep(.25)
        else:
            raise RuntimeError('모바일 서버가 시작되지 않았습니다. .tmp/mobile-backend.log를 확인해 주세요.')
    if occupied(8443,config['ip']):
        print('집 안 HTTPS 서버가 이미 실행 중입니다: '+config['url'])
        return
    if occupied(8443):
        raise RuntimeError('8443 포트가 사용 중입니다. 실행 중인 집 안 서버를 확인해 주세요.')
    process = start('https',[str(CADDY),'run','--config',str(ROOT/'Caddy.lan'),'--adapter','caddyfile'],environment)
    time.sleep(2)
    if process.poll() is not None:
        raise RuntimeError('HTTPS 서버가 시작되지 않았습니다. .tmp/mobile-https.log를 확인해 주세요.')
    print('집 안 전송 서버를 시작했습니다: '+config['url'])
    print('휴대폰에는 로컬 CA 공개 인증서를 신뢰하도록 한 번 설정해야 합니다. 인터넷 포트포워딩은 사용하지 않습니다.')


if __name__ == '__main__':
    try:
        main()
    except (OSError,RuntimeError,subprocess.CalledProcessError) as exc:
        print(str(exc))
        sys.exit(1)
