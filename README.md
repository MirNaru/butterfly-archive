# Butterfly Archive

나비 출현 추적 시스템의 개발환경입니다. 현재는 React, FastAPI, SQLite 연결 확인만 구현되어 있습니다.

## 설치 환경

- Windows 10 64비트
- Node.js 24.22.1, npm 11.19.1
- Python 3.13.15, SQLite 3.50.4
- Git 2.55.0.windows.5, GitHub CLI 2.103.0
- React 19, TypeScript 6, Vite 8, FastAPI
- 정확한 패키지 버전은 frontend/package-lock.json과 backend/requirements*.txt에 기록합니다.

## 구조

- frontend/src: 연결 확인 화면과 API 호출
- frontend/vite.config.ts: 개발용 API 프록시
- backend/app: 상태 API와 SQLite 연결
- backend/tests: API 성공 및 실패, SQLite 읽기와 쓰기 테스트
- backend/.venv: 프로젝트 전용 Python 가상환경, Git 제외
- data: 로컬 데이터베이스와 개인 관찰 자료, Git 제외
- .env.example: 비밀 값이 없는 환경변수 예시

## 처음 설치

새 PowerShell을 열고 프로젝트 루트로 이동하세요. 설치 직후 기존 터미널에는 PATH 변경이 반영되지 않을 수 있습니다.

```powershell
py -3.13 -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
cd frontend
npm.cmd ci
cd ..
```

실행만 필요한 경우 requirements-dev.txt 대신 requirements.txt를 사용하세요.
가상환경 활성화는 필요하지 않으며 PowerShell 실행 정책을 변경하지 않습니다.

## 실행

프로젝트 루트에서 첫 번째 PowerShell:

```powershell
.\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

프로젝트 루트에서 두 번째 PowerShell:

```powershell
cd frontend
npm.cmd run dev
```

- 화면: http://127.0.0.1:5173/
- API 문서: http://127.0.0.1:8000/docs
- 상태 API: http://127.0.0.1:8000/api/health
- 정상 화면: React → FastAPI → SQLite 연결 성공
- 각 터미널에서 Ctrl+C로 서버를 종료합니다.

프론트엔드는 /api/health를 호출하고 Vite가 8000 포트의 FastAPI로 전달합니다.
이 프록시는 개발 서버 전용입니다. 향후 배포 시 API 연결 구성을 별도로 정해야 합니다.
두 서버 모두 이 PC의 로컬 주소에만 바인딩합니다.

## 환경변수와 개인 데이터

기본 설정으로 바로 실행할 수 있습니다. 변경이 필요하면 .env.example을 .env로 복사하세요.
.env는 백엔드에서 자동으로 읽으며 기존 프로세스 환경변수를 우선합니다.
BUTTERFLY_DB_PATH는 프로젝트 루트를 기준으로 해석합니다.
기본 데이터베이스는 data/butterfly.sqlite3이며 상태 API 최초 호출 시 생성됩니다.
실제 관찰 테이블은 아직 생성하지 않습니다.

개인 관찰 기록, 사진, 가져오기 및 내보내기 자료는 data, observations, imports, exports 폴더에 보관하세요.
이 폴더들과 SQLite 파일, 가상환경, 의존성, 임시 파일, .env, 인증키 파일은 Git에서 제외합니다.
.gitignore는 임의의 소스 파일에 직접 입력한 비밀 값이나 개인 데이터를 자동으로 판별하지 못합니다.
API 키를 소스 코드에 넣지 마세요. 프론트엔드에 전달하는 환경변수도 비밀 저장용으로 사용하지 마세요.

## 테스트

프로젝트 루트에서:

```powershell
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -q -c backend/pytest.ini
.\backend\.venv\Scripts\python.exe -m pip check
cd frontend
npm.cmd run build
npm.cmd run lint
cd ..
```

서버 실행 중 API 프록시 확인:

```powershell
Invoke-RestMethod http://127.0.0.1:5173/api/health
```

SQLite 쓰기 테스트는 임시 데이터베이스에서 수행하며 개인 데이터베이스를 수정하지 않습니다.
현재 Starlette TestClient에서 httpx 사용 중단 예정 경고가 발생하지만 테스트는 통과합니다.

## 의존성 관리

- 프론트엔드: package.json과 package-lock.json을 함께 관리하고 재설치는 npm.cmd ci를 사용합니다.
- 백엔드: requirements.in은 직접 사용하는 실행 의존성, requirements-dev.in은 테스트 의존성을 설명합니다.
- requirements.txt와 requirements-dev.txt는 전이 의존성까지 고정한 설치 목록입니다.
- 의존성 변경 시 깨끗한 가상환경에서 실행 의존성을 먼저 설치하고 pip freeze로 requirements.txt를 갱신합니다. 이어 테스트 의존성을 설치한 뒤 requirements-dev.txt를 갱신하고 테스트합니다.

## GitHub

비공개 저장소: https://github.com/MirNaru/butterfly-archive

기본 브랜치는 main이며 origin 원격 저장소에 연결합니다.
GitHub CLI 인증 정보는 프로젝트 파일에 저장하지 않습니다.
