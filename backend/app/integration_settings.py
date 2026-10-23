"""공식 서버만 호출하고 비밀 값과 원격 오류 본문을 응답에서 제외합니다."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from app.api_usage import reserve


class IntegrationError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def maps_ready() -> bool:
    return (os.getenv("MAPS_ENABLED") == "true" and os.getenv("MAPS_FREE_TIER_CONFIRMED") == "true"
            and bool(os.getenv("NAVER_MAPS_CLIENT_ID")) and bool(os.getenv("NAVER_MAPS_CLIENT_SECRET")))


def require_maps() -> dict[str, str]:
    if not maps_ready():
        raise IntegrationError("지도 설정 또는 무료 적용·한도 확인이 필요합니다. 표와 직접 입력을 이용해 주세요.", 503)
    return {"X-NCP-APIGW-API-KEY-ID": os.environ["NAVER_MAPS_CLIENT_ID"],
            "X-NCP-APIGW-API-KEY": os.environ["NAVER_MAPS_CLIENT_SECRET"]}


def kma_ready() -> bool:
    return (os.getenv("KMA_ENABLED") == "true" and os.getenv("KMA_API_PROVIDER") == "apihub"
            and bool(os.getenv("KMA_API_KEY")))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_bytes(service: str, url: str, params: dict, headers: dict | None = None) -> bytes:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.username or parsed.hostname not in {"maps.apigw.ntruss.com", "apihub.kma.go.kr"}:
        raise IntegrationError("허용되지 않은 외부 서비스입니다.")
    reserve(service)  # DB 오류도 호출 전에 중단합니다.
    request = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers=headers or {})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
            data = response.read(1_000_001)
        if len(data) > 1_000_000:
            raise IntegrationError("응답 크기 제한을 초과했습니다.")
        return data
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise IntegrationError("인증 또는 해당 API 활용신청·서비스 URL 설정을 확인해 주세요.", 503) from None
        if error.code == 429:
            raise IntegrationError("제공자 사용 한도에 도달했습니다. 자동 재시도하지 않습니다.", 429) from None
        raise IntegrationError("외부 서비스가 요청을 처리하지 못했습니다. 기존 자료는 유지됩니다.") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise IntegrationError("외부 서비스에 연결할 수 없습니다. 기존 자료는 유지됩니다.", 503) from None


def request_json(service: str, url: str, params: dict, headers: dict) -> dict:
    try:
        data = json.loads(request_bytes(service, url, params, headers))
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except (ValueError, UnicodeError):
        raise IntegrationError("외부 응답 형식을 확인할 수 없습니다.") from None
