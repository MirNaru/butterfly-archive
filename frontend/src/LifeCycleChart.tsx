// 알·애벌레·번데기·어른벌레의 도감 참고 막대와 관찰 상자 수염을 같은 연간 축에 표시합니다.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { LifeStage, SpeciesReference } from './models'
import { LIFE_STAGES, dayLabel, slotStart, rangeParts, stageData, densityShape, adultExtremes, inLifePeriod, isOutlier, BOX_MINIMUM, periodBounds, periodLabel } from './lifeCycle'
import type { LifeFilter, LifeSample } from './lifeCycle'
const x = (day: number) => ((day - 1) % 366 + 366) % 366
export default function LifeCycleChart({ reference, samples, filter, name }: { reference: SpeciesReference; samples: LifeSample[]; filter: LifeFilter; name: string }) {
  const clipId = useId()
  const {year, region, source} = filter
  const plotted = useMemo(() => LIFE_STAGES.map(stage => {
    const data = stageData(reference, samples, stage.key, {year, region, source})
    return { stage, data, shapes:data.groups.map(densityShape) }
  }), [reference, samples, year, region, source])
  const [periodId,setPeriodId] = useState('')
  const [outliersOnly, setOutliersOnly] = useState(false)
  const [detail, setDetail] = useState<LifeStage | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (detail) dialog.current?.showModal(); else dialog.current?.close() }, [detail])
  const selected = detail ? stageData(reference, samples, detail, filter) : null
  const stageName = LIFE_STAGES.find(s => s.key === detail)?.label
  return <div className="life-chart">
    <div className="life-axis"><span>월</span><svg viewBox="0 0 366 16" aria-hidden="true">{Array.from({ length: 12 }, (_, month) => <text key={month} x={slotStart(month * 3 + 1) - 1 + 4} y="12">{month + 1}</text>)}</svg></div>
    {plotted.map(({stage, data, shapes}) => {
      const tooltip = [`${name} · ${stage.label}`, `지역: ${filter.region || '전체'} / 관찰 연도: ${filter.year || '전체'}`, ...data.windows.map(p => `참고 ${periodLabel(p)} · ${p.source}${p.edition ? ` / ${p.edition}` : ''} · ${p.region || '지역 미지정'}`), `집계 관찰 ${data.samples.length}사례 · 성장 단계 도감 추정 ${data.samples.filter(p => p.stageEstimated).length}사례`, ...data.groups.filter(g => g.box).map(g => `상자 ${dayLabel(g.box!.q1)} ~ ${dayLabel(g.box!.q3)}, 중앙 ${dayLabel(g.box!.median)}, 수염 ${dayLabel(g.box!.low)} ~ ${dayLabel(g.box!.high)}, ${g.box!.n}사례`), ...data.samples.slice(0, 8).map(p => `${p.date} · ${p.place || '장소 미상'} · ${p.source}`), '클릭하면 전체 출처와 관찰 사례를 확인합니다.'].join('\n')
      return <button type="button" className="life-stage" key={stage.key} style={{ '--life-color': stage.color } as CSSProperties} title={tooltip} aria-label={`${name} ${stage.label} 한살이 기간 · 참고 ${data.windows.length}개 · 관찰 ${data.samples.length}사례 · 상자 ${data.groups.filter(g => g.box).length}개`} onClick={() => { setOutliersOnly(false); setPeriodId(''); setDetail(stage.key) }}><span>{stage.label}</span>{!data.windows.length && !data.samples.length ? <span className="life-empty">자료 미등록</span> : <svg viewBox="0 0 366 24" aria-hidden="true">
        {Array.from({ length: 12 }, (_, month) => <line key={month} x1={slotStart(month * 3 + 1) - 1} x2={slotStart(month * 3 + 1) - 1} y1="1" y2="23" className="life-grid" />)}
        {data.windows.flatMap(p => rangeParts(periodBounds(p).start, periodBounds(p).end + 1).map(([start, end], i) => <rect key={`${p.id}-${i}`} x={start} y="3" width={end - start} height="18" rx="2" className="life-reference" />))}
        {data.groups.map((g, index) => {
          const shape = shapes[index]
          if (!g.box || !shape) return null
          return <g key={index} className="life-box">
            {shape.paths.map((path, i) => <path key={`fill-${i}`} d={path.fill} stroke="none" />)}
            {rangeParts(g.box.q1, g.box.q3).map(([start, end], i) => <line key={`b-${i}`} x1={start} x2={Math.max(start + 1, end)} y1="20" y2="20" />)}
            {shape.paths.map((path, i) => <path key={`curve-${i}`} d={path.curve} fill="none" />)}
            {[g.box.low, g.box.high].map((value, i) => <line key={i} x1={x(value)} x2={x(value)} y1="5" y2="20" />)}
            {[[g.box.q1, shape.q1Y], [g.box.q3, shape.q3Y]].map(([day, top], i) => <line key={`q-${i}`} x1={x(day)} x2={x(day)} y1={top} y2="20" />)}
            <defs><clipPath id={`${clipId}-${stage.key}-${index}`}>
              {shape.paths.map((path, i) => <path key={i} d={path.fill} />)}
            </clipPath></defs>
            <line x1={x(g.box.median)} x2={x(g.box.median)} y1={shape.medianY} y2="20" strokeLinecap="butt" clipPath={`url(#${clipId}-${stage.key}-${index})`} />
            {g.box.outliers.map((value, i) => <circle key={`o-${i}`} cx={x(value)} cy="12" r="2.5" className="life-outlier" />)}
          </g>
        })}
        {data.groups.filter(g => !g.box).flatMap(g => g.samples).map((p, index) => <circle key={index} cx={x(p.day)} cy="12" r="2.3" className="life-point" />)}
      </svg>}</button>
    })}
    <dialog ref={dialog} className="life-detail-dialog" aria-label={`${name} ${stageName || ''} 한살이 자료`} onCancel={() => setDetail(null)}>
      {selected && <><div className="toolbar"><h2>{name} · {stageName}</h2><button type="button" onClick={() => setDetail(null)}>닫기</button></div><p className="hint">지역 {filter.region || '전체'} · 관찰 연도 {filter.year || '전체'} · 검수 후 등록한 관찰 {selected.samples.length}사례 · 성장 단계 도감 추정 {selected.samples.filter(p => p.stageEstimated).length}사례</p><h3>도감·참고 자료</h3>{selected.windows.length ? <ul>{selected.windows.map(p => <li key={p.id}>{periodLabel(p)}<br />{p.source}{p.edition && ` / ${p.edition}`} · {p.region || '지역 미지정'}{p.notes && <p>{p.notes}</p>}</li>)}</ul> : <p>참고 기간 미등록입니다. 관찰 통계는 도감과 독립적으로 계산합니다.</p>}
      <h3>관찰 분포</h3>{selected.groups.map((g, index) => <p key={index}>{dayLabel(g.start)} ~ {dayLabel(g.end)} · {g.samples.length}사례{g.box ? ` · 가운데 50% ${dayLabel(g.box.q1)} ~ ${dayLabel(g.box.q3)} · 중앙값 ${dayLabel(g.box.median)} · 수염 ${dayLabel(g.box.low)} ~ ${dayLabel(g.box.high)} · 수염 밖 ${g.box.outliers.length}사례` : ` · ${BOX_MINIMUM}사례 미만으로 관찰점만 표시`}</p>)}<p className="hint">선택 조건의 같은 단계 관찰 {BOX_MINIMUM}사례부터 연간 분포 상자를 표시합니다. 도감 기간은 표본 선택·사분위수·수염·이상값 판정에 사용하지 않습니다. 도감 추정 단계는 실제 사진 검수로 확인한 단계와 구분합니다. 곡선은 14일 폭으로 부드럽게 연결한 관찰 사례 밀도이며 수염 안에서만 표시합니다. 높이는 각 단계 안에서 정규화하므로 개체 수나 단계 간 사례 수 비교에 사용하지 않습니다. 채워진 구간의 가로 범위와 밑변은 가운데 50%이며 색칠 면적의 비율을 뜻하지 않습니다. 내부 세로선은 중앙값, 양끝 세로선은 수염 범위입니다. 수염은 1.5 IQR 한계 안의 실제 관찰 범위이며 이상값도 점으로 보존합니다. 가장 긴 관찰 공백에서 연간 축을 나눠 연말·연초 관찰을 잇습니다. 여러 발생 차수를 자동 확정하거나 분리하지 않으며 빈 기간에도 연속 출현했다는 뜻은 아닙니다.</p>
      {detail === 'adult' && <><h3>지역별 최초·최후 어른벌레 사례</h3><p className="hint">선택 조건의 모든 연도를 월·일로 비교합니다. 실제 관찰 날짜와 원본 기록 번호를 함께 표시합니다.</p><div className="table-wrap"><table><thead><tr><th>지역</th><th>최초</th><th>최후</th></tr></thead><tbody>{adultExtremes(selected.samples).map(r=><tr key={r.region}><td>{r.region}</td><td>{r.firstSamples.map(s=>`${s.date} · ${s.observationIds.map(id=>`#${id}`).join(', ')}`).join(' / ')}</td><td>{r.lastSamples.map(s=>`${s.date} · ${s.observationIds.map(id=>`#${id}`).join(', ')}`).join(' / ')}</td></tr>)}</tbody></table></div></>}
      <h3>관찰 사례</h3><label>사례 구간<select value={periodId} onChange={e=>setPeriodId(e.target.value)}><option value="">전체</option>{selected.windows.map(p=><option key={p.id} value={p.id}>{periodLabel(p)}</option>)}<option value="outside">도감 구간 밖</option></select></label><label><input type="checkbox" checked={outliersOnly} onChange={e => setOutliersOnly(e.target.checked)} />통계적 이상값만 보기</label><p className="hint">원본 기록 번호를 관찰 기록 검색창에 #번호 형식으로 입력하면 찾을 수 있습니다. 기존 검색 조건도 함께 적용됩니다.</p>{selected.samples.length ? <div className="table-wrap"><table><thead><tr><th>관찰일</th><th>장소</th><th>출처</th><th>단계 근거</th><th>원본 기록</th></tr></thead><tbody>{selected.samples.filter(p => (!outliersOnly || isOutlier(p, selected.groups)) && (!periodId || (periodId === 'outside' ? !selected.windows.some(w=>inLifePeriod(p,w)) : selected.windows.some(w=>w.id===periodId && inLifePeriod(p,w))))).map((p, i) => <tr key={i}><td>{p.date}{isOutlier(p, selected.groups) && ' · 통계적 이상값'}</td><td>{p.place || '미상'}</td><td>{p.sourceType === 'direct' ? '직접 관찰' : '간접 관찰'}{p.source !== '직접 관찰' && ` · ${p.source}`}</td><td>{p.stageEstimated ? '도감 기간 추정' : '기록에 지정된 단계'}</td><td>{p.observationIds.map(id => `#${id}`).join(', ')}</td></tr>)}</tbody></table></div> : <p>집계할 관찰이 없습니다. 기록 없음은 실제 부재를 뜻하지 않습니다.</p>}</>}
    </dialog>
  </div>
}
