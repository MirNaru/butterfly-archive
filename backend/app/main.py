"""로컬 기록 API의 시작, 오류 응답과 경로를 정의합니다."""
import sqlite3
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from app.database import connect_database
from app.migrations import initialize_database
from app import records
from app.schemas import Species, SpeciesInput, Survey, SurveyInput


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Butterfly Archive", version="0.2.0", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    errors = [{"field": ".".join(str(part) for part in e["loc"][1:]),
               "message": e["msg"].removeprefix("Value error, ")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": "입력값을 확인해 주세요.", "errors": errors})


@app.exception_handler(sqlite3.Error)
async def database_error(request: Request, exc: sqlite3.Error):
    return JSONResponse(status_code=503, content={"detail": "데이터베이스 작업에 실패했습니다. 저장 상태를 확인하고 다시 시도해 주세요."})


@app.get("/api/species", response_model=list[Species])
def species_list():
    return records.list_species()


@app.post("/api/species", response_model=Species, status_code=201)
def species_create(value: SpeciesInput):
    try:
        return records.create_species(value)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "같은 국명의 종이 이미 있습니다.") from exc


@app.get("/api/surveys", response_model=list[Survey])
def surveys_list():
    return records.list_surveys()


@app.post("/api/surveys", response_model=Survey, status_code=201)
def survey_create(value: SurveyInput):
    try:
        return records.create_survey(value)
    except records.UnknownSpecies as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/api/surveys/{survey_id}", response_model=Survey)
def survey_detail(survey_id: int):
    result = records.get_survey(survey_id)
    if result is None:
        raise HTTPException(404, "조사 기록을 찾을 수 없습니다.")
    return result


@app.get("/api/health")
def health() -> dict[str, str]:
    try:
        with connect_database() as connection:
            connection.execute("SELECT 1").fetchone()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return {"status": "ok", "database": "ok"}
