"""Estimate ASOS coverage using a grid of land points and nearest stations."""
from functools import lru_cache
import math
from app import regions, weather

@lru_cache(maxsize=1)
def land_grid():
    return tuple((lat / 10, lon / 10, code)
                 for lat in range(330, 387) for lon in range(1245, 1321)
                 if (code := regions.locate_point(lat / 10, lon / 10)))

def coverage(stations, distribution, altitude=None, elevation_at=None):
    if altitude is not None and elevation_at is None:
        raise ValueError("고도 격자 자료가 필요합니다.")
    result = {}
    for lat, lon, code in land_grid():
        if not isinstance(code, str):
            continue
        station = min(stations, key=lambda s: weather.distance_km(lat, lon, s))
        distance = weather.distance_km(lat, lon, station)
        if altitude is not None:
            elevation = elevation_at(lat, lon)
            if elevation is None or abs(elevation - altitude) > 50:
                continue
        sid = station["id"]
        result[sid] = max(distance, result.get(sid, 0))
    return result

def choose_station(stations, scores, cells, distribution):
    if not distribution:
        return None
    candidates = []
    for station in stations:
        sid = station["id"]
        if sid not in scores or sid not in cells:
            continue
        code = regions.locate_point(station["latitude"], station["longitude"])
        if code and distribution.intersection(
            {code, code[:2], *regions.observation_area_codes(code)}
        ):
            candidates.append((scores[sid], sid))
    if not candidates:
        return None
    _, sid = min(candidates)
    return next(s for s in stations if s["id"] == sid), cells[sid]
