"""사용자 요청에 한해 주소와 좌표를 변환합니다. 비밀 키는 백엔드에만 둡니다."""
import math
from app.integration_settings import require_maps, request_json, IntegrationError


def geocode(query: str) -> list[dict]:
    data = request_json("geocode", "https://maps.apigw.ntruss.com/map-geocode/v2/geocode",
                        {"query": query, "count": 5}, require_maps())
    try:
        if data.get("status") != "OK":
            raise ValueError()
        result = []
        for row in data["addresses"]:
            lat, lon = float(row["y"]), float(row["x"])
            if not math.isfinite(lat) or not math.isfinite(lon) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError()
            result.append({"address": row.get("roadAddress") or row.get("jibunAddress") or query,
                           "latitude": lat, "longitude": lon})
        return result
    except (ValueError, KeyError, TypeError):
        raise IntegrationError("주소 검색 응답을 해석할 수 없습니다.") from None


def reverse(latitude: float, longitude: float) -> dict:
    data = request_json("reverse", "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc",
                        {"coords": f"{longitude},{latitude}", "output": "json", "orders": "roadaddr,addr"}, require_maps())
    try:
        code = data["status"]["code"]
        if code == 3:
            return {"address": None}
        if code != 0:
            raise ValueError()
        for row in data["results"]:
            region, land = row["region"], row["land"]
            parts = [region[f"area{i}"].get("name", "") for i in range(1, 4)]
            number = land.get("number1", "") + ("-" + land["number2"] if land.get("number2") else "")
            if row["name"] == "roadaddr":
                parts = parts[:2] + [land.get("name", ""), number]
            else:
                parts += [number]
            return {"address": " ".join(p for p in parts if p)}
        return {"address": None}
    except (ValueError, KeyError, TypeError):
        raise IntegrationError("주소 변환 응답을 해석할 수 없습니다.") from None
