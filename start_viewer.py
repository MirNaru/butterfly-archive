"""권한이 분리된 조회 작업만 시작합니다. HTTPS는 명시적 옵션으로만 시작합니다."""
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
if __name__=='__main__':
    config=ROOT/'data/viewer-deployment.json'
    if not config.is_file():raise SystemExit('setup_viewer.ps1로 계정과 파일 권한을 먼저 준비해 주세요.')
    state=json.loads(config.read_text(encoding='utf-8-sig'))
    task=state['https_task'] if '--https' in sys.argv else state['viewer_task']
    if task not in ('ButterflyArchive-HTTPS','ButterflyArchive-Viewer'):raise SystemExit('실행 작업을 확인해 주세요.')
    command=['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'start_viewer.ps1')]
    if '--https' in sys.argv:command.append('-Https')
    subprocess.run(command,check=True,creationflags=subprocess.CREATE_NO_WINDOW)
    print('외부 HTTPS 조회 서버 시작 요청' if '--https' in sys.argv else '읽기 전용 사본 서버 시작 요청')
