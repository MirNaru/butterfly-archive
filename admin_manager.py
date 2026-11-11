"""Windows 관리자 창에서 기존 실행기와 조회 사본 갱신을 호출합니다."""
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.request import ProxyHandler, Request, build_opener

import start_app
import start_mobile

ROOT = Path(__file__).resolve().parent
DEPLOYMENT = Path(os.environ['ProgramData']) / 'ButterflyArchiveViewer'
DOMAIN = 'archive.mirnaru.kro.kr'
KST = timezone(timedelta(hours=9))


def viewer_ready():
    try:
        request = Request('http://127.0.0.1:8010/viewer/health',
                          headers={'Host': DOMAIN, 'X-Forwarded-Proto': 'https'})
        with build_opener(ProxyHandler({})).open(request, timeout=2) as reply:
            return json.load(reply).get('role') == 'readonly-viewer'
    except (OSError, ValueError):
        return False


def live_certificate():
    with socket.create_connection(('127.0.0.1', 443), timeout=3) as connection:
        with ssl.create_default_context().wrap_socket(connection, server_hostname=DOMAIN) as tls:
            return tls.getpeercert()


def certificate_summary():
    try:
        cert = live_certificate()
        source = '제공 중'
    except OSError:
        source = '로컬 저장본'
        paths = list((DEPLOYMENT / 'tls' / 'certificates').glob(f'*/{DOMAIN}/{DOMAIN}.crt'))
        if not paths:
            return 'red', '공인 인증서 상태를 확인할 수 없습니다. 인증서 상태 버튼으로 확인하세요.'
        cert = ssl._ssl._test_decode_cert(str(max(paths, key=lambda p: p.stat().st_mtime)))
    expiry = datetime.fromtimestamp(ssl.cert_time_to_seconds(cert['notAfter']), KST)
    issued = datetime.fromtimestamp(ssl.cert_time_to_seconds(cert['notBefore']), KST)
    remaining = expiry - datetime.now(KST)
    due = expiry - timedelta(days=14)
    state = 'red' if remaining.total_seconds() <= 0 else 'yellow' if remaining <= timedelta(days=14) or source != '제공 중' else 'green'
    detail = f'{source} · 발급/갱신 {issued:%Y-%m-%d} · 만료 {expiry:%Y-%m-%d} · 점검 {due:%Y-%m-%d}'
    if remaining <= timedelta(days=14):
        detail += ' · 만료 14일 이내입니다. 인증서 갱신 확인을 눌러 주세요.'
    return state, detail


def run_script(name, *args):
    subprocess.run([sys.executable, str(ROOT / name), *args], cwd=ROOT, check=True, timeout=100,
                   creationflags=subprocess.CREATE_NO_WINDOW)


def viewer_start():
    sys.path.insert(0, str(ROOT / 'backend'))
    from app.viewer_export import make_snapshot, root
    if root() != DEPLOYMENT.resolve():
        raise RuntimeError('설치된 읽기 전용 서버와 사본 경로가 일치하지 않습니다.')
    result = make_snapshot()
    print(f"읽기 전용 사본 갱신 완료 · 관찰 {result['records']}건", flush=True)
    if not viewer_ready():
        run_script('start_viewer.py')
        for _ in range(20):
            if viewer_ready():
                break
            time.sleep(.25)
        else:
            raise RuntimeError('읽기 전용 서버가 응답하지 않습니다.')
    if not start_app.occupied(443):
        run_script('start_viewer.py', '--https')
    print('읽기 전용 서버 시작 확인. 인증서 상태에서 HTTPS 제공 여부를 확인할 수 있습니다.')


def certificate_check():
    if not start_app.occupied(443):
        run_script('start_viewer.py', '--https')
    print(certificate_summary()[1])
    print('Caddy가 갱신 일정을 관리합니다. 버튼은 HTTPS를 켜고 갱신 상태를 확인합니다.')
    log = DEPLOYMENT / 'logs' / 'https-stderr.log'
    if log.is_file():
        with log.open('rb') as source:
            source.seek(max(0, log.stat().st_size - 65536))
            lines = source.read().splitlines()
        for line in reversed(lines):
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get('logger') in ('tls.renew','tls.obtain') and event.get('identifier') == DOMAIN:
                message = re.sub(r'[^\w .-]', '', str(event.get('msg', '')))[:100]
                print('최근 Caddy 인증서 기록 · ' + message)
                break


def status():
    try:
        mobile = start_mobile.mobile_ready() and start_mobile.occupied(8443,start_mobile.configuration()['ip'])
    except (OSError, RuntimeError, ValueError, KeyError):
        mobile = False
    try:
        certificate = certificate_summary()
    except (OSError, ValueError, KeyError):
        certificate = ('red','인증서 정보를 읽을 수 없습니다.')
    pc = start_app.ready('frontend')
    viewer = viewer_ready()
    print('green|실행 중' if pc else 'red|꺼짐')
    if viewer and not certificate[1].startswith('제공 중'):
        print('yellow|읽기 서버 실행 중 · 외부 HTTPS 확인 필요')
    else:
        print('green|실행 중' if viewer else 'red|꺼짐')
    print('green|실행 중' if mobile else 'red|꺼짐')
    print('|'.join(certificate))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    os.environ['PYTHONIOENCODING'] = 'utf-8'
    commands = {'pc': lambda: run_script('start_app.py'),
                'viewer': viewer_start, 'mobile': lambda: run_script('start_mobile.py'),
                'certificate': certificate_check, 'status': status}
    try:
        commands[sys.argv[1]]()
    except Exception as error:
        print(f'작업 실패 · {getattr(error,"detail",str(error))}',file=sys.stderr)
        sys.exit(1)
