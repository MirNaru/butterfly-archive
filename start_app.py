"""로컬 서버를 중복 없이 실행하고 기본 브라우저로 나비 아카이브를 엽니다."""
import ctypes
import json
import msvcrt
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
from urllib.request import ProxyHandler, build_opener
import webbrowser

ROOT = Path(__file__).resolve().parent
LOGS = ROOT / '.tmp'
FRONT_URL = 'http://127.0.0.1:5173'
OPENER = build_opener(ProxyHandler({}))


def read_url(url):
    with OPENER.open(url, timeout=2) as response:
        return response.read().decode('utf-8')


def ready(kind):
    try:
        if kind == 'backend':
            base = 'http://127.0.0.1:8000'
            return (json.loads(read_url(base + '/openapi.json'))['info']['title'] == 'Butterfly Archive'
                    and json.loads(read_url(base + '/api/health')) == {'status': 'ok', 'database': 'ok'})
        return ('<title>Butterfly Archive</title>' in read_url(FRONT_URL)
                and json.loads(read_url(FRONT_URL + '/api/health')) == {'status': 'ok', 'database': 'ok'})
    except (OSError, ValueError, KeyError):
        return False


def occupied(port):
    with socket.socket() as sock:
        sock.settimeout(1)
        return sock.connect_ex(('127.0.0.1', port)) == 0


def start_server(kind, port, command, cwd):
    if ready(kind):
        return
    if occupied(port):
        raise RuntimeError(f'{port}번 포트가 사용 중이지만 나비 아카이브의 정상 응답을 확인하지 못했습니다.\n'
                           '기존 서버 상태를 확인해 주세요. 다른 프로그램은 종료하지 않았습니다.')
    environment = os.environ.copy()
    # 실행용 화면 서버는 시험 서버가 아닌 기본 로컬 백엔드에 연결합니다.
    environment['BUTTERFLY_API_TARGET'] = 'http://127.0.0.1:8000'
    with (LOGS / f'launcher-{kind}.log').open('ab') as log:
        process = subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                   stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if ready(kind):
            return
        if process.poll() is not None:
            break
        time.sleep(0.25)
    raise RuntimeError(f'{kind} 서버가 준비되지 않았습니다.\n{LOGS / ("launcher-" + kind + ".log")}\n'
                       '로그를 확인한 뒤 다시 실행해 주세요. 먼저 켜진 서버는 그대로 유지됩니다.')


def main():
    LOGS.mkdir(exist_ok=True)
    with (LOGS / 'launcher.lock').open('a+b') as lock:
        if lock.tell() == 0:
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return  # 먼저 실행한 창이 서버 준비와 브라우저 열기를 담당합니다.
        try:
            python = ROOT / 'backend/.venv/Scripts/python.exe'
            node = shutil.which('node.exe')
            vite = ROOT / 'frontend/node_modules/vite/bin/vite.js'
            if not python.is_file() or not node or not vite.is_file():
                raise RuntimeError('설치된 Python 가상환경, Node.js 또는 화면 실행 파일이 없습니다. README의 설치 안내를 확인해 주세요.')
            start_server('backend', 8000, [str(python), '-m', 'uvicorn', 'app.main:app', '--app-dir',
                         'backend', '--host', '127.0.0.1', '--port', '8000'], ROOT)
            start_server('frontend', 5173, [node, str(vite), '--host', '127.0.0.1', '--port',
                         '5173', '--strictPort'], ROOT / 'frontend')
            if '--no-browser' not in sys.argv:
                sys.path.insert(0,str(ROOT/'backend'))
                from app.local_access import key
                local_key=key()
                address=FRONT_URL+('#local='+local_key if local_key else '')
                if not webbrowser.open(address):
                    raise RuntimeError(f'서버는 실행 중입니다. 브라우저에서 {FRONT_URL} 주소를 열어 주세요.')
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if '--no-browser' in sys.argv:
            print(str(error), file=sys.stderr)
        else:
            ctypes.windll.user32.MessageBoxW(None, str(error), '나비 아카이브 실행 안내', 0x10)
        sys.exit(1)
