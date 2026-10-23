import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from collections.abc import Iterator
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env", encoding="utf-8-sig")


@contextmanager
def connect_database(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    target = path or Path(os.getenv("BUTTERFLY_DB_PATH", "data/butterfly.sqlite3"))
    if not target.is_absolute():
        target = PROJECT_ROOT / target
    target.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(target)
    try:
        with connection:
            yield connection
    finally:
        connection.close()
