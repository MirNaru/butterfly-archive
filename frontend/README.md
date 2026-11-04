# PC 프론트엔드

전체 실행은 [루트 README](../README.md)를 따릅니다. 파일별 역할과 서버 경계는 [구조 안내](../docs/architecture.md), 변경 전 규칙은 [AGENTS.md](../AGENTS.md)를 읽습니다.

이 폴더에서 `npm.cmd run build`, `npm.cmd run lint`를 실행합니다. 계산 회귀 검사는 프로젝트 루트에서 `node --test frontend/tests/*.mjs`를 실행합니다. Vite 개발 서버는 루프백 전용이며 PC 인증 세션은 루트 실행기로 엽니다. 개인 자료·키·시험 파일을 public 폴더에 복사하지 않습니다.
