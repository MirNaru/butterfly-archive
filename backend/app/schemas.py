"""조사·종별 기록의 입력과 응답을 검증합니다."""
from datetime import date, time
from typing import Annotated, Literal, Self
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator

Count = Annotated[int, Field(strict=True, gt=0, le=1_000_000)]


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SpeciesInput(InputModel):
    korean_name: str = Field(min_length=1, max_length=100)
    scientific_name: str | None = Field(default=None, max_length=200)


class Species(SpeciesInput):
    id: int
    host_plants: str = ''


class Location(InputModel):
    place_name: str = Field(default="", max_length=200)
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    location_method: Literal["unknown", "approximate", "manual", "gps", "map", "address"] = "unknown"

    @model_validator(mode="after")
    def coordinate_pair(self) -> Self:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("위도와 경도를 함께 입력해 주세요.")
        if self.location_method in ("manual", "gps", "map", "address") and self.latitude is None:
            raise ValueError("지정한 위치 방식에는 좌표가 필요합니다.")
        return self


class TaggedInput(Location):
    photo_ids: list[Annotated[int, Field(strict=True, gt=0)]] = Field(default_factory=list, max_length=2000)
    tags: list[Annotated[str, Field(min_length=1, max_length=60)]] = Field(default_factory=list, max_length=60)

    @field_validator('tags')
    @classmethod
    def unique_tags(cls, values):
        return list(dict.fromkeys(values))

    @field_validator('photo_ids')
    @classmethod
    def unique_photos(cls, values):
        return list(dict.fromkeys(values))


class ObservationInput(TaggedInput):
    source_type: Literal['direct', 'indirect'] = 'direct'
    source_note: str = Field(default='', max_length=2000)
    species_id: Count | None = None
    result: Literal["observed", "not_found"] = "observed"
    observation_date: date | None = None
    observation_time: time | None = None
    stage: Literal["unknown", "egg", "larva", "pupa", "adult"] = "unknown"
    sex: Literal["unknown", "male", "female", "mixed"] = "unknown"
    count: Count | None = None
    count_estimated: bool = Field(default=False, strict=True)
    identification: Literal["unidentified", "candidate", "user_confirmed"] = "unidentified"
    capture_status: Literal["unknown", "not_captured", "captured"] = "unknown"
    captured_count: Count | None = None
    notes: str = Field(default="", max_length=5000)

    @model_validator(mode="after")
    def coherent_record(self) -> Self:
        if self.source_type == 'indirect' and not self.source_note:
            raise ValueError('간접 관찰은 원문 주소나 자료명 등 출처를 입력해 주세요.')
        if self.observation_time and self.observation_time.tzinfo:
            raise ValueError("관찰 시각은 한국 현지 시각으로 입력해 주세요.")
        if self.species_id is None and self.identification != "unidentified":
            raise ValueError("동정 상태에 맞는 종을 선택해 주세요.")
        if self.count_estimated and self.count is None:
            raise ValueError("추정 개체 수를 입력해 주세요.")
        if self.captured_count is not None and self.capture_status != "captured":
            raise ValueError("채집 수량은 채집한 경우에만 입력할 수 있습니다.")
        if self.count is not None and self.captured_count is not None and self.captured_count > self.count:
            raise ValueError("채집 수량은 관찰 개체 수를 초과할 수 없습니다.")
        if self.result == "not_found":
            if self.species_id is None:
                raise ValueError("미발견 기록에는 찾으려던 종을 선택해 주세요.")
            if (self.count is not None or self.captured_count is not None or
                    self.capture_status != "not_captured" or self.stage != "unknown" or
                    self.sex != "unknown" or self.identification != "unidentified"):
                raise ValueError("미발견 기록에는 관찰된 개체·단계·동정·채집 정보를 넣을 수 없습니다.")
        return self


class SurveyInput(TaggedInput):
    survey_date: date
    purpose: Literal["general", "target", "host_plant", "exploration"] = "general"
    notes: str = Field(default="", max_length=5000)
    observations: list[ObservationInput] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def survey_location(self) -> Self:
        if not self.place_name and self.latitude is None:
            raise ValueError("조사 장소명 또는 좌표를 입력해 주세요.")
        return self


class ObservationUpdate(ObservationInput):
    id: Annotated[int, Field(strict=True, gt=0)] | None = None


class SurveyUpdate(SurveyInput):
    expected_updated_at: str = Field(min_length=1, max_length=100)
    observations: list[ObservationUpdate] = Field(max_length=100)


class Observation(ObservationInput):
    effective_tags: list[str]
    id: int
    species_name: str | None
    effective_date: date
    effective_place: str
    effective_latitude: float | None
    effective_longitude: float | None


class Survey(SurveyInput):
    id: int
    created_at: str
    updated_at: str
    observations: list[Observation]
