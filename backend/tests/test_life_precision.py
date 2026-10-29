"""초중·중후의 일 단위 경계와 단계 중첩·겨울 구간을 검증합니다."""
from datetime import date
import pytest
from app.exploration import LifePeriod, season
from app.collection_import import infer_stage

def day(month, d): return (date(2000,month,d)-date(2000,1,1)).days+1
def p(stage, start, end, a, b):
    return dict(id=stage,stage=stage,start=start,end=end,start_day=day(*a),end_day=day(*b),source='사용자 제공 시험 표',enabled=True)

def test_mosi_exact_boundaries_later_stage_and_winter():
    periods=[p('egg',17,6,(6,11),(2,29)),p('larva',7,14,(3,1),(5,15)),p('pupa',13,14,(5,1),(5,15)),p('adult',13,17,(5,6),(6,15))]
    ref={'lifecycle':periods}
    for observed, expected in [(date(2026,5,1),'pupa'),(date(2026,5,5),'pupa'),(date(2026,5,6),'adult'),(date(2026,6,15),'adult'),(date(2026,6,16),'egg'),(date(2026,2,28),'egg'),(date(2024,2,29),'egg'),(date(2026,3,1),'larva'),(date(2026,4,30),'larva')]:
        assert infer_stage(ref,observed,'')['stage']==expected
    assert not season([periods[-1]],date(2026,5,5))['active']
    assert season([periods[-1]],date(2026,5,6))['days_left']==40
    assert not season([periods[-1]],date(2026,6,16))['active']
    assert season([periods[0]],date(2026,2,28))['days_left']==0

def test_exact_start_and_end_must_be_paired():
    value=p('adult',13,17,(5,6),(6,15))
    value['end_day']=None
    with pytest.raises(ValueError): LifePeriod.model_validate(value)
