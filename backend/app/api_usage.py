"""한국 날짜 기준으로 호출 시도 수를 원자적으로 예약합니다. 실패도 차감합니다."""
from datetime import datetime, timedelta, timezone
from app.database import connect_database

KST = timezone(timedelta(hours=9))
LIMITS = {"geocode": (100, 1000), "reverse": (100, 1000), "map": (100, 1000), "kma": (500, 10000)}


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
        if (today and today[0] >= daily) or month >= monthly:
            raise UsageLimitError("로컬 호출 한도에 도달했습니다. 자동으로 추가 호출하지 않습니다.")
        connection.execute("""INSERT INTO api_usage VALUES (?, ?, 1)
            ON CONFLICT(service, day) DO UPDATE SET attempts=attempts+1""", (service, day))


def usage() -> list[dict]:
    day = now_kst().date().isoformat()
    with connect_database() as connection:
        return [{"service": service, "daily_limit": limits[0], "monthly_limit": limits[1],
                 "today": connection.execute("SELECT COALESCE(SUM(attempts),0) FROM api_usage WHERE service=? AND day=?", (service, day)).fetchone()[0],
                 "month": connection.execute("SELECT COALESCE(SUM(attempts),0) FROM api_usage WHERE service=? AND day LIKE ?", (service, day[:7] + "%")).fetchone()[0]}
                for service, limits in LIMITS.items()]
