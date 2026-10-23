from fastapi import FastAPI, HTTPException
from app.database import connect_database

app = FastAPI(title="Butterfly Archive", version="0.1.0")


@app.get("/api/health")
def health() -> dict[str, str]:
    try:
        with connect_database() as connection:
            connection.execute("SELECT 1").fetchone()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return {"status": "ok", "database": "ok"}
