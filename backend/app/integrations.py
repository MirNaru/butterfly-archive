"""지도와 기상 요청의 로컬 API, 입력 검증, 안전한 오류를 정의합니다."""
import os
from typing import Literal
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from app.schemas import InputModel
from app import api_usage, naver_maps, weather_queue, weather_store
from app.integration_settings import require_maps, maps_ready, kma_ready


def local_request(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin:
        try:
            parsed = urlparse(origin)
            allowed = (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost")
                       and parsed.port in (5173, 5174, 8000, 8001) and not parsed.username)
        except ValueError:
            allowed = False
        if not allowed:
            raise HTTPException(403, "로컬 프로그램에서만 외부 조회를 요청할 수 있습니다.")


router = APIRouter(prefix="/api", dependencies=[Depends(local_request)])


class AddressRequest(InputModel):
    query: str = Field(min_length=2, max_length=200)


class CoordinateRequest(InputModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)


class WeatherTarget(InputModel):
    target_type: Literal["survey", "observation"]
    target_id: int = Field(gt=0, strict=True)


class WeatherRequest(WeatherTarget):
    station_id: int = Field(gt=0, lt=10000, strict=True)
    refresh: bool = Field(default=False, strict=True)


@router.get("/integrations/status")
def status():
    return {"maps_ready": maps_ready(), "weather_ready": kma_ready(), "usage": api_usage.usage()}


@router.post("/maps/permit")
def map_permit():
    require_maps()
    api_usage.reserve("map")
    return {"client_id": os.environ["NAVER_MAPS_CLIENT_ID"]}


@router.post("/maps/geocode")
def geocode(value: AddressRequest):
    return naver_maps.geocode(value.query)


@router.post("/maps/reverse")
def reverse(value: CoordinateRequest):
    return naver_maps.reverse(value.latitude, value.longitude)


@router.get("/weather/{target_type}/{target_id}")
def stored_weather(target_type: Literal["survey", "observation"], target_id: int):
    return weather_store.saved(target_type, target_id)


@router.post("/weather/stations")
def weather_stations(value: WeatherTarget):
    return weather_store.station_list(weather_store.context(value.target_type, value.target_id))


@router.post("/weather/query")
def weather_query(value: WeatherRequest):
    return weather_store.query(value.target_type, value.target_id, value.station_id, value.refresh)


class WeatherQueueRequest(InputModel):
    limit: int = Field(default=15000, ge=1, le=15000, strict=True)


@router.post("/weather-queue")
def start_weather_queue(value: WeatherQueueRequest, request: Request):
    if request.headers.get("X-Butterfly-Client") != "app":
        raise HTTPException(403, "기록 화면에서 요청해 주세요.")
    return weather_queue.start(value.limit)


@router.get("/weather-queue")
def weather_queue_status():
    return weather_queue.status()
