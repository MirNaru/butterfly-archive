"""기상청 ASOS 공식 텍스트를 해석하며 현장값과 관측소값을 구분합니다."""
import math
import os
import re
from app.integration_settings import request_bytes, kma_ready, IntegrationError

BASE = "https://apihub.kma.go.kr/api/typ01/url/"
FIELDS = {
    "hourly": [("TA", "기온", "도"), ("HM", "상대습도", "%"), ("WS", "풍속", "m/s"),
               ("RN_DAY", "해당 시각까지 일 누적 강수량", "mm")],
    "daily": [("TA_AVG", "일 평균기온", "도"), ("TA_MAX", "일 최고기온", "도"),
              ("TA_MIN", "일 최저기온", "도"), ("HM_AVG", "일 평균 상대습도", "%"),
              ("WS_AVG", "일 평균풍속", "m/s"), ("RN_DAY", "일 강수량", "mm")],
}


def fetch_text(endpoint: str, params: dict) -> str:
    if not kma_ready():
        raise IntegrationError("기상청 API허브 키와 활성화 설정을 확인해 주세요.", 503)
    raw = request_bytes("kma", BASE + endpoint, {**params, "authKey": os.environ["KMA_API_KEY"]})
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return raw.decode("cp949")
        except UnicodeDecodeError:
            raise IntegrationError("기상자료 문자 형식을 읽지 못했습니다.") from None


def parse_stations(text: str) -> list[dict]:
    if "STN_KO" not in text or "#7777END" not in text:
        raise IntegrationError("관측소 정보 응답을 확인할 수 없습니다.")
    result = []
    try:
        for line in text.splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            parts = line.split()
            station_id, lon, lat = int(parts[0]), float(parts[1]), float(parts[2])
            if len(parts) < 12 or not (0 < station_id < 10000 and -90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError()
            result.append({"id": station_id, "name": parts[10], "latitude": lat, "longitude": lon})
    except (ValueError, IndexError):
        raise IntegrationError("관측소 목록 형식이 예상과 다릅니다.") from None
    if not result:
        raise IntegrationError("해당 시점의 관측소 목록이 없습니다.", 404)
    return result


def parse_weather(text: str, station_id: int, target: str, kind: str) -> dict:
    # help=1의 번호가 붙은 필드 설명으로 열을 매핑합니다. 일자료는 CSV입니다.
    fields = {m[2]: int(m[1]) - 1 for m in re.finditer(r"(?m)^[ \t]*#\s*(\d+)\.\s*(\w+)\s*:", text)}
    if not {"TM", "STN", *(f[0] for f in FIELDS[kind])}.issubset(fields) or "#7777END" not in text:
        raise IntegrationError("기상자료 형식이 예상과 다릅니다. 기존 자료를 유지합니다.")
    matches = []
    try:
        for line in text.splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            parts = line.strip().rstrip(",").split(",") if "," in line else line.split()
            if parts[fields["TM"]].strip() == target and int(parts[fields["STN"]]) == station_id:
                matches.append(parts)
        if not matches:
            raise IntegrationError("해당 관측소·시각의 자료가 없습니다. 다른 관측소를 선택해 주세요.", 404)
        if len(matches) != 1:
            raise ValueError()
        values = []
        for code, label, unit in FIELDS[kind]:
            raw = matches[0][fields[code]].strip()
            value = float(raw)
            valid = math.isfinite(value)
            if code.startswith("TA"):
                valid = valid and -80 <= value <= 60  # 음수 기온은 보존합니다.
            elif code.startswith("HM"):
                valid = valid and 0 <= value <= 100
            else:
                valid = valid and value >= 0
            values.append({"code": code, "label": label, "unit": unit,
                           "value": value if valid else None, "raw": raw})
        return {"values": values, "source": "기상청 ASOS", "kind": kind, "target_time": target,
                "source_url": BASE + ("kma_sfctm2.php" if kind == "hourly" else "kma_sfcdd.php")}
    except (ValueError, IndexError):
        raise IntegrationError("기상자료 값을 해석하지 못했습니다. 기존 자료를 유지합니다.") from None


def distance_km(lat: float, lon: float, station: dict) -> float:
    a, b = math.radians(lat), math.radians(station["latitude"])
    dlat, dlon = b - a, math.radians(station["longitude"] - lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(a) * math.cos(b) * math.sin(dlon / 2) ** 2
    return round(6371 * 2 * math.asin(math.sqrt(min(1, max(0, h)))), 2)
