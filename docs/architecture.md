# 현재 구조와 작업 안내

이 문서는 코드 탐색의 시작점입니다. 실행 방법은 [README](../README.md), 입력·보존 규칙은 [data-model.md](data-model.md), 화면 동작은 [requirements.md](requirements.md), 남은 검증과 과거 성능 결과는 [improvement.md](improvement.md)를 읽습니다. 원래 계획과 검증 당시 기록을 현재 사양으로 오해하지 않습니다.

## 폴더와 실행 경계

| 위치 | 역할 / 유지 기준 |
| --- | --- |
| `frontend/src` | PC React 화면·상태·API 형식. 브라우저에서 DB에 직접 접근하지 않습니다. |
| `frontend/tests` | Node 기반 계산·필터·도표 회귀 검사. |
| `backend/app/main.py` | PC FastAPI 경로·요청 연결. `schemas.py` 입력 검증, `database.py` 연결, `migrations.py` 스키마 14. |
| `backend/tests` | 독립 시험 DB 기반 API·자료 보존·보안 검사. 개인 DB로 시험하지 않습니다. |
| `backend/app/mobile_server.py`, `mobile_web` | 집 안 전송 전용 서버와 휴대폰 정적 화면·사진 메타데이터 추출. |
| `viewer_server.py`, `viewer_web` | 원본 DB를 읽지 않는 외부 사본 조회 서버·정적 화면. |
| `extensions/naturing` | 사용자 Chrome에서 시작하는 네이처링 확장. 설치·연결은 해당 README. |
| `backend/app/assets` | 로컬 지역 경계 원본과 표시용 단순화 자료. 정밀 판정과 화면 경량 경계는 구분합니다. |
| `start_app.py`, `나비 아카이브 실행.cmd` | PC 루프백 서버와 인증 세션 실행. |
| `start_mobile.py`, `setup_lan.ps1`, `Caddy.lan` | 집 안 HTTPS·방화벽·로컬 인증서 구성. |
| `start_viewer.py`, `start_viewer.ps1`, `setup_viewer.ps1`, `Caddyfile` | 제한 계정의 외부 조회 구성·실행. 코드 수정만으로 운영 복사본이 자동 갱신되지는 않습니다. |
| `data` | 실제 DB·진행 파일·사진·논문·키·인증서·보호 사본. Git 제외, 임의 이동 금지. |
| `.tmp` | 실행 로그·시험 산출물·보안 권한 복구 자료. 통째로 지우지 않습니다. |
| `data/maintenance-archives` | 정리한 파일의 로컬 ZIP·경로/크기/SHA256 목록. 개인 자료를 포함할 수 있으며 Git 제외. |
| `.git`, `backend/.venv`, `frontend/node_modules` | 저장소·실행 의존성. 파일 수가 많아도 임의 삭제하지 않습니다. |

기본 DB는 `data/butterfly.sqlite3`이며 환경의 BUTTERFLY_DB_PATH 설정이 우선합니다. 설정 값·키를 출력하거나 문서에 복사하지 않습니다. 외부 조회 배포본은 프로젝트 밖 `C:/ProgramData/ButterflyArchiveViewer`에 있으며 이번 로컬 폴더 정리 범위에서 제외합니다.

## 작업별 코드 찾기

| 작업 | 먼저 볼 파일 |
| --- | --- |
| 탭·공통 상태·등록 변경분 반영 | `frontend/src/App.tsx`, `api.ts`, `models.ts`, `backend/app/main.py` |
| 기록·탐사 편집·검색 | `RecordTable.tsx`, `SurveyForm.tsx`, `SearchFilters.tsx`, `recordSearch.ts`, `backend/app/records.py`, `schemas.py` |
| 도감·세부 정보·입력 | `ButterflyInfo.tsx`, `ReferenceEditor.tsx`, `SpeciesDetails.tsx`, `LifeCycleEditor.tsx`, `backend/app/exploration.py` |
| 한살이 통계·표시 | `lifeCycle.ts`, `LifeCycleChart.tsx`, `frontend/tests/lifeCycle.test.mjs` |
| 지도·출현지역 | `MapView.tsx`, `regionLayer.ts`, `RegionPicker.tsx`, `backend/app/regions.py`, `assets/README.md` |
| 수집·종/성장 단계 수정 | `CollectionInbox.tsx`, `InaturalistControls.tsx`, `backend/app/collection.py`, `collection_import.py`, `inaturalist.py` |
| 논문·PDF | `PaperBrowser.tsx`, `backend/app/papers.py`, `paper_pdf.py` |
| 사진·모바일 | `PhotoPicker.tsx`, `MobileInbox.tsx`, `backend/app/photos.py`, `mobile.py`, `mobile_server.py`, `mobile_web/metadata.js` |
| 소장·휴지통 | `HoldingsView.tsx`, `TrashDialog.tsx`, `backend/app/holdings.py`, `trash.py` |
| 기상·외부 호출 제한 | `WeatherPanel.tsx`, `backend/app/weather.py`, `weather_store.py`, `api_usage.py`, `integration_settings.py` |
| PC 인증·외부 사본 | `backend/app/local_access.py`, `viewer_export.py`, `ViewerControls.tsx`, 루트 viewer 실행 파일 |

위 표의 프론트 파일은 `frontend/src`, 백엔드 파일은 명시된 경로 기준입니다. 실제 요청 경로와 형식은 `api.ts`·`main.py`·`schemas.py`를 함께 확인합니다.

## 상태 갱신과 성능

지도 핀은 기본적으로 숨깁니다. 기존 핀 표시 버튼으로 켜며 별도의 전체 핀 버튼은 없습니다. 현재 탭에 필요한 계산을 우선하고 기록 행은 화면 높이에 맞춰 일부만 렌더링합니다. 도감은 종 행을 나누어 표시하고 화면 주변의 도표를 생성합니다. 지도 경계는 축척·화면 영역별 표시 자료와 도형 재사용을 적용하며 정밀 지역 판정 자료는 유지합니다.


수집 대기함에서 등록하면 서버는 같은 저장 작업에서 읽은 해당 탐사만 응답합니다. 지도·기록·도감은 하나의 탐사 목록을 공유하고 탐사 번호로 변경분을 합칩니다. 초기 자료가 아직 없거나 이전 서버가 변경분을 제공하지 않으면 전체 목록을 조회합니다. 관찰·소장·도감 변경과 명시적 새로고침은 관련 참고자료를 다시 읽도록 합니다. 도감 재진입 시 같은 자료 버전과 조건에 한해 조회 결과를 재사용하며, 종 목록은 첫 화면부터 나누어 표시합니다.


집 안 입력과 외부 조회를 별도 서버로 분리합니다.

- PC: 127.0.0.1:5173 → 127.0.0.1:8000. 실행기가 보호 파일의 키로 HttpOnly·SameSite=Strict 쿠키를 발급합니다. 원본 API는 이 쿠키를 확인합니다. 건강 상태·스키마·세션 발급과 자체 Bearer 인증을 사용하는 네이처링 수신 외에는 미인증 접근을 거절합니다. Vite도 data·환경 설정·키·DB 파일의 직접 제공을 금지합니다.
- 집 안 입력: 지정 내부 IP의 HTTPS 8443 → 127.0.0.1:8001. Caddy.lan의 로컬 CA를 사용하며 집 안 방화벽·클라이언트 주소 범위·Host·HTTPS·Origin·전용 헤더·크기·세션을 검사합니다. 공개 도메인과 다른 주소·코드를 사용합니다.
- 외부 조회: 공인 HTTPS 443 → 127.0.0.1:8010. viewer_server.py는 PC 앱 모듈이나 원본 DB를 가져오지 않습니다. Caddy와 조회 서버는 별도 제한 계정으로 실행합니다. 사용자가 외부 HTTPS 자동 재시도를 요청했습니다. 실제 발급·프로세스·포트 상태는 로그와 실행 상태로 확인합니다.

PC의 viewer_export가 한 SQLite 읽기 트랜잭션에서 등록 관찰·종 참고자료·소장을 모아 조회 전용 JSON 사본을 원자적으로 교체합니다. 조회 서버는 이 사본만 인증 후 제공하며 필터와 검색은 브라우저에서 수행합니다. 관찰 쓰기·사진 업로드·임의 파일 제공 API는 없습니다. 로그인·로그아웃은 조회 전용 인증 저장소만 변경합니다. 사본에 좌표·메모가 포함되므로 로그인한 기기에 전달한 자료 자체의 복사를 차단하는 기능은 아닙니다.

Windows 별도 계정에는 원본 프로젝트·DB 접근 거부, 실행 파일·사본 읽기 전용, 조회 인증·로그·TLS 폴더 쓰기 권한만 설정합니다. 현재 사용자만 DPAPI로 해독 가능한 자격으로 숨김 실행합니다. 별도 계정이 같은 PC의 앱을 HTTP로 호출하는 경로도 PC 인증으로 차단합니다. 조회 앱 로그는 크기 제한 회전 방식이며 쿼리·본문·코드·로그인 토큰을 기록하지 않습니다. 외부 Caddy는 별도 회전 접속 로그를 남기고 인증 쿠키·Authorization 헤더를 기본 마스킹합니다. 연결 코드는 URL이 아닌 본문으로 전송합니다.

사진 정보 추출·검수 등록은 기존 규칙을 유지합니다. 파일에서 빠진 촬영 시각·GPS를 추정하지 않고, 추출 원문과 PC 검수값을 분리합니다. Bluetooth·HEIC·백그라운드 전송은 미구현입니다. 실제 휴대폰의 두 선택 경로에서 GPS를 읽지 못한 문제는 investigation 대상이며 PC 원본의 GPS와 파서 정상 동작은 확인했습니다.


모바일 웹 사진 진단은 선택 파일의 크기·전체 SHA-256·EXIF 블록 수·GPS 디렉터리와 태그 번호·읽기 오류를 기기 화면에만 표시합니다. 전송 없이 확인할 수 있고 진단 항목은 API에 추가하지 않습니다. GPS 위도·경도와 방향 태그의 자료형·값 개수·파일 범위·분모 0 여부·분자 모두 0 여부·방향 유효성과 숫자/분·초/상한 검사를 추가로 표시합니다. 이 상세 진단에는 실제 좌표값이나 원시 방향 문자열을 포함하지 않습니다. 해시 차이만으로 위치 가림을 확정하지 않으며, 오류가 있는 경우 GPS 없음과 구분합니다. 실제 S23 Ultra에서 같은 원본의 두 선택 경로 비교는 아직 필요합니다.


### Android 집 안 사진 전송 앱

android는 MediaStore·ACCESS_MEDIA_LOCATION 동의 후 setRequireOriginal과 ExifInterface로 촬영 정보를 읽고 고정된 집 안 HTTPS의 기존 /m/api에 전송하는 Kotlin 앱입니다. MainActivity는 화면, TransferModel은 메모리 선택 상태·순차 처리, PhotoMetadataReader·PhotoMetadata는 추출·전송 형식, MobileApiClient는 Wi-Fi·HTTPS·쿠키, SessionStore는 Keystore 암호화를 담당합니다. 사진 목록은 ViewModel로 회전 시 보존하되 영구 저장하지 않으며 세션만 암호화해 백업 제외 영역에 둡니다. PC DB·수신 API 구조는 유지합니다. 로컬 공개 CA는 빌드 산출물에만 복사하며 실행법과 검증 범위는 android/README.md를 따릅니다.

내 사진 검수의 기본 흐름은 `MobileInbox.tsx`에서 빈 종별 기록의 탐사를 등록하고 `App.tsx`에서 기존 `SurveyForm` 수정 창으로 이동하는 방식입니다. `mobile.py`는 메타데이터 사진을 탐사 공통 연결에 저장하며 사진 생성·탐사 생성·대기 상태 변경을 같은 트랜잭션으로 처리합니다. DB v14와 기존 단일 직접 관찰 등록 요청은 유지합니다.
