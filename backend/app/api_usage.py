"""한국 날짜 기준으로 호출 시도 수를 원자적으로 예약합니다. 실패도 차감합니다."""
from datetime import datetime, timedelta, timezone
import os
from app.database import connect_database

KST = timezone(timedelta(hours=9))
# 사용자가 확인한 제공자 한도입니다. None은 해당 기간의 별도 제한이 없음을 뜻합니다.
LIMITS = {"geocode": (None, 3_000_000), "reverse": (None, 3_000_000),
          "map": (None, 6_000_000), "kma": (20_000, None)}


def reported_usage(service: str) -> dict:
    """콘솔에서 사용자가 확인한 참고값이며 실시간 제공자 조회가 아닙니다."""
    date = os.getenv("NAVER_USAGE_SNAPSHOT_DATE", "")
    value = os.getenv(f"NAVER_{service.upper()}_USAGE_SNAPSHOT", "")
    try:
        datetime.strptime(date, "%Y-%m-%d")
        count = int(value)
        if service == "kma" or count < 0:
            raise ValueError()
    except ValueError:
        return {"reported_count": None, "reported_date": None}
    return {"reported_count": count, "reported_date": date}


class UsageLimitError(Exception):
    pass


def now_kst() -> datetime:
    return datetime.now(KST)


def reserve(service: str) -> None:
    daily, monthly = LIMITS[service]
    day = now_kst().date().isoformat()
    with connect_database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        today = connection.execute("SELECT attempts FROM api_usage WHERE service=? AND day=?", (service, day)).fetchone()
        month = connection.execute("SELECT COALESCE(SUM(attempts),0) FROM api_usage WHERE service=? AND day LIKE ?",
                                   (service, day[:7] + "%")).fetchone()[0]
        if (daily is not None and today and today[0] >= daily) or (monthly is not None and month >= monthly):
            raise UsageLimitError("로컬 호출 한도에 도달했습니다. 자동으로 추가 호출하지 않습니다.")
        connection.execute("""INSERT INTO api_usage VALUES (?, ?, 1)
            ON CONFLICT(service, day) DO UPDATE SET attempts=attempts+1""", (service, day))


def usage() -> list[dict]:
    day = now_kst().date().isoformat()
    with connect_database() as connection:
        return [{"service": service, "daily_limit": limits[0], "monthly_limit": limits[1], **reported_usage(service),
                 "today": connection.execute("SELECT COALESCE(SUM(attempts),0) FROM api_usage WHERE service=? AND day=?", (service, day)).fetchone()[0],
                 "month": connection.execute("SELECT COALESCE(SUM(attempts),0) FROM api_usage WHERE service=? AND day LIKE ?", (service, day[:7] + "%")).fetchone()[0]}
                for service, limits in LIMITS.items()]
