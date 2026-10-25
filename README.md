# Butterfly Archive

나비 출현 기록 및 추적 시스템입니다. 현재는 종 수동 등록, 조사와 여러 종별 기록의 등록·목록·상세 조회, 간단한 검색과 조사 표를 사용할 수 있습니다. 네이버 지도·주소 검색과 기상청 ASOS 자료의 조회·저장도 사용할 수 있습니다. 수정·삭제, 사진, 엑셀 반입과 출현 도표는 아직 구현되지 않았습니다.

## 개발 설계 문서

아래 문서는 합의한 목표 사양이며, 기능 구현 완료를 의미하지 않습니다.

- [개발 계획과 착수 준비](docs/plan.md)
- [데이터 구조와 입력 규칙](docs/data-model.md)
- [화면 구성과 완료 기준](docs/requirements.md)
- [미구현 및 확인 사항](docs/improvement.md)
- [사용자 원래 계획서](DEVELOPMENT%20PROPOSAL.md)

## 설치 환경

- Windows 10 64비트
- Node.js 24.22.1, npm 11.19.1
- Python 3.13.15, SQLite 3.50.4
- Git 2.55.0.windows.5, GitHub CLI 2.103.0
- React 19, TypeScript 6, Vite 8, FastAPI
- 정확한 패키지 버전은 frontend/package-lock.json과 backend/requirements*.txt에 기록합니다.

## 구조

- frontend/src: 기록 등록·조회, 지도·위치 선택, 저장 기상 화면과 API 호출
- frontend/vite.config.ts: 개발용 API 프록시
- backend/app: 기록 API, 지도·기상 연동, 호출 제한과 SQLite 저장
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
- 화면에서 종을 수동 등록한 뒤 새 조사를 작성할 수 있습니다. 동정 미확정 상태로도 관찰 기록을 저장할 수 있습니다.
- 하단 지도·표 탭에서 같은 기록을 조회합니다. 지도 탭을 처음 열 때만 지도를 생성하며 탭 전환 시 유지합니다.
- 각 터미널에서 Ctrl+C로 서버를 종료합니다.

프론트엔드는 /api/health를 호출하고 Vite가 8000 포트의 FastAPI로 전달합니다.
이 프록시는 개발 서버 전용입니다. 향후 배포 시 API 연결 구성을 별도로 정해야 합니다.
두 서버 모두 이 PC의 로컬 주소에만 바인딩합니다.

## 환경변수와 개인 데이터

기본 설정으로 바로 실행할 수 있습니다. 변경이 필요하면 .env.example을 .env로 복사하세요.
.env는 백엔드에서 자동으로 읽으며 기존 프로세스 환경변수를 우선합니다.
BUTTERFLY_DB_PATH는 프로젝트 루트를 기준으로 해석합니다.
기본 데이터베이스는 data/butterfly.sqlite3이며 서버 시작 시 생성됩니다.
서버 시작 시 스키마 버전 2를 적용합니다. 버전 1의 기록 테이블은 보존하고 기상자료·연결·관측소 캐시·호출량 테이블을 추가합니다. 변경 전 내용이 있는 DB는 같은 폴더에 `.before-v2-날짜.bak`로 먼저 백업합니다. 초기화·삭제는 하지 않으며 스키마 추가 실패는 되돌립니다. 같은 테이블명 충돌이나 지원하지 않는 버전이면 실행을 중단합니다.

기본 API는 GET/POST `/api/species`, GET/POST `/api/surveys`, GET `/api/surveys/{id}`입니다. 수정·삭제 API는 아직 없습니다. 기존 서버가 실행 중이면 종료 후 위 명령으로 다시 실행해 주세요.

검증에는 `.tmp/browser-check.sqlite3`를 사용하는 별도 서버를 사용했습니다. 이 파일의 가상 기록은 개인 DB로 복사하지 않습니다. 다른 포트로 검증하려면 백엔드의 `BUTTERFLY_DB_PATH`와 프론트엔드 프로세스의 `BUTTERFLY_API_TARGET`을 명시적으로 지정합니다. 기본값은 기존 8000 포트입니다.

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

현재 백엔드 자동 테스트는 48건이며 실제 외부 호출을 차단한 임시 DB에서 검사합니다. 호출 한도·동시 요청·재시작, 실패 시 기존 기상 보존, 자료 재사용, 날짜·시각 상속과 변경 감지, 버전 1 이전·실패 복구를 포함합니다. 공개 서울시청 위치의 실제 지도·주소 검색·좌표 주소 확인과 서울 관측소의 2025-10-22 일자료·12시 시간자료를 검증했습니다. 브라우저에서 핀 선택·숨김·복구, 검색 필터, 지도·표 전환, 주소 적용과 지도 클릭을 확인했습니다. 수백 건 성능, 사진, 수정·삭제는 미검증·미구현 범위입니다.

2026년 10월 24일 마무리 검증에서 자동 테스트 43건, TypeScript 검사, Vite 빌드, 린트가 통과했습니다. 실제 사용 DB의 버전 2 적용과 변경 전 백업을 확인했으며, 지도·표 왕복 시 지도 생성 수가 증가하지 않았습니다. 기상은 추가 외부 조회 없이 기존 검증 결과와 저장·재사용 테스트로 확인했습니다. 키·DB·백업은 Git 제외 상태이며 커밋·푸시는 수행하지 않았습니다.

스키마 변경이 실패하면 변경 트랜잭션은 되돌아갑니다. 백업 복원이 필요한 경우 서버를 종료하고 현재 DB와 백업을 모두 보존한 상태에서 복원 대상을 먼저 확인하세요. 새로 등록한 자료가 있는 DB 위에 이전 백업을 무조건 덮어쓰지 마세요. 사용자용 백업·복원 화면은 후속 구현입니다.

## 의존성 관리

- 프론트엔드: package.json과 package-lock.json을 함께 관리하고 재설치는 npm.cmd ci를 사용합니다.
- 백엔드: requirements.in은 직접 사용하는 실행 의존성, requirements-dev.in은 테스트 의존성을 설명합니다.
- requirements.txt와 requirements-dev.txt는 전이 의존성까지 고정한 설치 목록입니다.
- 의존성 변경 시 깨끗한 가상환경에서 실행 의존성을 먼저 설치하고 pip freeze로 requirements.txt를 갱신합니다. 이어 테스트 의존성을 설치한 뒤 requirements-dev.txt를 갱신하고 테스트합니다.

## GitHub

비공개 저장소: https://github.com/MirNaru/butterfly-archive

기본 브랜치는 main이며 origin 원격 저장소에 연결합니다.
GitHub CLI 인증 정보는 프로젝트 파일에 저장하지 않습니다.


## 지도와 기상 사용 방법

지도 위의 **핀 숨기기** 오른쪽에서 **일반지도 / 위성지도**를 전환할 수 있습니다. 현재 지도 객체의 유형만 바꾸므로 별도 지도 생성 요청을 보내지 않습니다. 지도 영역은 브라우저의 남은 높이를 채우며 좌우·하단 여백을 맞춥니다. 위성 유형은 [네이버 지도 공식 SDK](https://navermaps.github.io/maps.js.ncp/docs/tutorial-MapTypes.html)의 기본 기능을 사용하며 기존 Dynamic Map 설정·한도를 유지합니다.

1. `.env`에 기존 키를 보관합니다. 대표 계정의 무료 적용과 네이버 콘솔의 API별 강제 사용 제한을 확인한 뒤 `MAPS_ENABLED=true`, `MAPS_FREE_TIER_CONFIRMED=true`, `KMA_ENABLED=true`로 활성화합니다. 예제 파일은 기본 비활성 상태입니다. 설정 변경 후 백엔드를 다시 시작합니다.
2. 조사 등록에서 **지도·주소로 위치 선택**을 열고 주소 검색 결과나 지도 클릭 위치를 선택한 다음 **이 위치 적용**을 누릅니다. 주소 없는 위치는 좌표만 적용할 수 있습니다. 직접 입력도 가능합니다.
3. 기록을 저장한 다음 상세의 **기상**을 열어 **관측소 찾기 → 관측소 선택 → 기상 조회하여 저장**을 누릅니다. 관측소 목록은 기록 당시 시점으로 조회하며 좌표가 있으면 직선거리를 표시합니다.
4. 관찰 시각이 있으면 해당 시각 직전 정시의 시간자료를 사용합니다. 예를 들어 12:34는 12:00 KST 자료입니다. 시각이 없으면 일자료를 사용하며, 당일 일자료는 조회하지 않습니다. 기온·습도·풍속·강수량을 표시하고 일자료는 평균·최고·최저 기온을 구분합니다. 누락값은 0으로 바꾸지 않습니다.
5. 저장값은 화면 재조회·재실행 시 자동 갱신하지 않습니다. 동일 관측소·종류·시점은 재사용합니다. **기상자료 다시 조회**는 확인 후 새 자료를 저장하고 해당 기록의 연결만 바꿉니다. 실패하면 기존 자료를 보존합니다.

### 비용과 전송 범위

- 사용자가 2026년 10월 24일 확인한 한도를 반영했습니다. Dynamic Map은 월 6,000,000회, Geocoding·Reverse Geocoding은 각각 월 3,000,000회, 기상청은 일 20,000회입니다. 네이버의 별도 로컬 일 제한과 기상청의 별도 로컬 월 제한은 두지 않습니다. 한국 날짜를 기준으로 SQLite에 호출 전 예약하며 실패도 차감합니다. 자동 재시도와 유료 대체 서비스는 없습니다.
- 화면에는 앱 집계와 한도를 표시합니다. 네이버 콘솔에서 확인한 사용량은 `.env`의 `NAVER_USAGE_SNAPSHOT_DATE`, `NAVER_MAP_USAGE_SNAPSHOT`, `NAVER_GEOCODE_USAGE_SNAPSHOT`, `NAVER_REVERSE_USAGE_SNAPSHOT`에 선택적으로 보관하며 확인 날짜와 함께 별도로 표시합니다. 참고값은 자동 갱신하거나 앱 집계에 더하지 않습니다. 제공자 실시간 사용량 조회 기능은 아닙니다.
- 화면의 **연동 상태·로컬 사용량**에서 이 DB의 시도 수를 확인합니다. 브라우저 SDK의 실제 제공자 집계와 다를 수 있으며 다른 앱·DB·장치 사용량은 합산하지 못합니다. DB 복원으로 카운터가 과거로 돌아갈 수도 있으므로 제공자 콘솔의 강제 제한이 최종 비용 차단 수단입니다. 로컬 코드만으로 청구액 0원을 보증하지 않습니다.
- 네이버에는 표시할 지도 영역, 검색 주소, 명시적으로 주소 확인을 요청한 좌표가 전달됩니다. 기상청에는 관측소 번호와 대상 시각만 전달합니다. 종명·메모·사진은 전송하지 않습니다. 관측소 거리는 로컬에서 계산합니다.
- 공개 Client ID는 지도 SDK에 필요합니다. Client Secret과 기상청 키는 백엔드에만 보관하며 외부 오류 본문·인증 URL은 사용자 응답에 포함하지 않습니다.
- 기록 입력은 지도·기상 연결 실패와 분리되어 있습니다. 지도 한도 도달 시 표와 직접 위치 입력을 사용하고, 기상은 저장된 자료를 계속 열람합니다.

### 연동 모듈과 API

- 프론트엔드: `MapView.tsx`, `naverMaps.ts`, `LocationPicker.tsx`, `WeatherPanel.tsx`; 기존 `App.tsx`, `SurveyForm.tsx`, `api.ts`, `models.ts`, `App.css`에서 연결합니다.
- 백엔드: `integrations.py`의 입력 검증과 경로, `integration_settings.py`의 외부 요청·오류 처리, `api_usage.py`의 한도, `naver_maps.py`의 주소 변환, `weather.py`의 자료 해석, `weather_store.py`의 저장·재사용입니다. `main.py`, `migrations.py`, `schemas.py`도 갱신했습니다. 새 의존성은 없습니다.
- 로컬 조회: `GET /api/integrations/status`, `GET /api/weather/{target_type}/{target_id}`.
- 명시적 호출: `POST /api/maps/permit`, `/api/maps/geocode`, `/api/maps/reverse`, `/api/weather/stations`, `/api/weather/query`. 요청 형태는 로컬 `/docs`에서 확인합니다.
- 공식 참고: [네이버 지도 SDK](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Map.html), [네이버 Maps 사용 관리](https://guide.ncloud-docs.com/docs/application-maps-app-vpc), [기상청 ASOS](https://apihub.kma.go.kr/apiList.do?apiSeq=2).

한도 변경 후 자동 테스트 48건과 타입 검사·빌드·린트가 통과했습니다. 지도·주소 변환 월 한도와 기상청 일 한도의 마지막 허용 요청·다음 요청 차단을 외부 호출 없이 검사했습니다.

브라우저 사용 흐름도 별도 시험 DB에서 점검했습니다. 조사에 관찰 3마리·채집 1마리와 개별 날짜·장소를 가진 미발견 기록을 함께 저장하고 지도·표·검색으로 확인했습니다. 관찰 12:34에 저장된 12:00 ASOS 자료를 연결했으며 기상청 추가 호출은 없었습니다. 시험 DB에 일 한도 도달 상태를 만든 뒤 재조회 차단·기존 기상 보존·새 기록 저장을 확인했고, 시험 서버 재시작 후에도 기록과 기상이 유지됐습니다. 검증 후 개인 DB 연결로 복구했으며 시험 기록은 개인 DB로 복사하지 않았습니다.
