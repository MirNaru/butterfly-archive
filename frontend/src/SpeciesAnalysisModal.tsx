// 심층 분석 팝업에서만 연도·권역의 어른벌레 분포를 공통 월 축으로 비교합니다.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Species, Survey } from './models'
import { adultAnalysisGroups, BOX_MINIMUM, collectLifeSamples, dayLabel, densityShape, observationGroups, rangeParts, slotStart } from './lifeCycle'

const tones = ['#6840a0','#007682','#b84f00','#a82f57','#2866b1','#477422','#8a5c18','#424b64']
const yearColors = ['#b51d32', '#b84f00', '#987400', '#26753b', '#2162b3', '#743cb3']
const extraYearColors = ['#b12879', '#654128', '#202e69', '#525862']
const annualX = (day: number) => ((day - 1) % 366 + 366) % 366
const left = 65
const plotWidth = 1120
const plotHeight = 240
const top = 32

export default function SpeciesAnalysisModal({ species, surveys, onClose }: {
  species: Species; surveys: Survey[]; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [byRegion, setByRegion] = useState(false)
  const [selectedYear, setSelectedYear] = useState<string | null>(null)
  const [hovered, setHovered] = useState('')
  const [focused, setFocused] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  const samples = useMemo(() => collectLifeSamples(surveys,species.id), [surveys,species.id])
  const years = useMemo(() => [...new Set(samples.map(sample => sample.date.slice(0,4)))].sort().reverse(), [samples])
  const year = byRegion ? selectedYear ?? years[0] ?? '' : ''
  const {eligible, small, unknownRegion} = useMemo(() => adultAnalysisGroups(samples,byRegion,{year,region:'',source:''}), [samples,byRegion,year])
  const rows = useMemo(() => eligible.flatMap((group,index) => {
    const distribution = observationGroups(group.samples)[0]
    const shape = densityShape(distribution)
    const box = distribution.box
    if (!box || !shape) return []
    const dates = group.samples.map(sample => sample.day)
    const lastIndex = eligible.length - 1
    const palette = [...yearColors.slice(0,-1), ...extraYearColors]
    const yearColor = lastIndex < yearColors.length
      ? yearColors[Math.round(index * (yearColors.length-1) / Math.max(1,lastIndex))]
      : index === lastIndex ? yearColors.at(-1) : palette[index] ?? extraYearColors[(index-palette.length)%extraYearColors.length]
    const extraIndex = index - palette.length
    const dashed = !byRegion && index !== lastIndex && extraIndex >= 0
    const dash = dashed ? `${4 + Math.floor(extraIndex / extraYearColors.length)*2} 3` : undefined
    const color = byRegion
      ? tones[index] ?? `hsl(${index*137%360} 34% ${35 + index*7%27}%)`
      : yearColor
    return [{ group, shape, box, first:Math.min(...dates), last:Math.max(...dates), color, dash }]
  }).sort((a,b) => byRegion ? a.first-b.first : 0), [eligible,byRegion])
  const height = top + plotHeight + 25
  const maximum = Math.max(1,...rows.map(row => row.shape.maximum))
  const active = hovered || focused
  const keyFor = (group: typeof rows[number]['group']) => group.year+':'+group.regionCode
  const orderedRows = [...rows].sort((a,b) => Number(keyFor(a.group)===active)-Number(keyFor(b.group)===active))
  return <dialog ref={dialog} className="life-detail-dialog species-analysis-dialog" aria-label={species.korean_name + ' 심층 분석'}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}>
    <header className="toolbar"><h2>{species.korean_name} 심층 분석</h2><button type="button" onClick={onClose}>닫기</button></header>
    <div className="toolbar">
      <button type="button" aria-pressed={!byRegion} onClick={() => setByRegion(false)}>연도별</button>
      <button type="button" aria-pressed={byRegion} onClick={() => setByRegion(true)}>연도·지역별</button>
      {byRegion && years.length > 0 && <label>연도<select value={year} onChange={event => setSelectedYear(event.target.value)}>
        {years.map(value => <option key={value}>{value}</option>)}
      </select></label>}
    </div>
    <p className="hint">어른벌레 {BOX_MINIMUM}사례 이상인 그룹을 같은 366일 축에서 비교합니다. 피크 높이는 공통 눈금에서 날짜 주변에 모인 관찰 사례를 나타냅니다. 처음·마지막 날짜는 등록된 관찰 기록 기준입니다.</p>
    {byRegion && unknownRegion > 0 && <p className="hint">시·도를 확인할 수 없는 {unknownRegion}사례는 지역별 도표에서 제외했습니다.</p>}
    {!rows.length && <p>선택한 조건에서 {BOX_MINIMUM}사례 이상인 그룹이 없습니다.</p>}
    {rows.length > 0 && <div className="species-analysis-scroll" tabIndex={0} aria-label="어른벌레 관찰 비교 도표">
      <svg className="species-analysis-plot" viewBox={'0 0 1240 ' + height} role="img" aria-label={byRegion ? year + '년 시·도별 어른벌레 관찰 분포' : '연도별 어른벌레 관찰 분포'}>
        <text x="8" y="20">관찰 사례 밀도</text>
        <line x1={left} x2={left} y1={top} y2={top+plotHeight*20/24} className="life-grid"/>
        <line x1={left} x2={left+plotWidth} y1={top+plotHeight*20/24} y2={top+plotHeight*20/24} className="life-grid"/>
        {Array.from({length:12},(_,month) => {
          const x = left + annualX(slotStart(month*3+1))*plotWidth/366
          return <g key={month}><line x1={x} x2={x} y1={top} y2={top+plotHeight*20/24} className="life-grid"/><text x={x+5} y={height-22}>{month+1}월</text></g>
        })}
        <svg x={left} y={top} width={plotWidth} height={plotHeight} viewBox="0 0 366 24" preserveAspectRatio="none">
        {orderedRows.map(({group,shape,box,color,dash}) => (
          <g key={group.year+':'+group.regionCode}>
              <g stroke={color} fill={color} strokeWidth={keyFor(group)===active ? 3 : 1.2}
                opacity={active && keyFor(group)!==active ? .3 : 1}>
                <g transform={`translate(0 20) scale(1 ${shape.maximum/maximum}) translate(0 -20)`}>
                {shape.paths.map((path,i) => <path key={'fill-'+i} d={path.fill} stroke="none" opacity=".12"/>)}
                {shape.paths.map((path,i) => <path key={'curve-'+i} d={path.curve} fill="none" strokeDasharray={dash}/>)}
                {rangeParts(box.q1,box.q3).map(([start,end],i) => <line key={'base-'+i} x1={start} x2={Math.max(start+1,end)} y1="20" y2="20"/>)}
                {[[box.low,5],[box.high,5],[box.q1,shape.q1Y],[box.q3,shape.q3Y],[box.median,shape.medianY]].map(([day,roof],i) => <line key={i} x1={annualX(day)} x2={annualX(day)} y1={roof} y2="20"/>)}
                </g>
                {box.outliers.map((day,i) => <ellipse key={i} cx={annualX(day)} cy={19} rx="1.1" ry=".35" fill="white"/>)}
              </g>

          </g>
        ))}
        </svg>
      </svg>
      <ul className="species-analysis-legend" aria-label="도표 범례">{rows.map(({group,first,last,color,dash}) => <li key={keyFor(group)}><span tabIndex={0}
        onMouseEnter={() => setHovered(keyFor(group))} onMouseLeave={() => setHovered('')}
        onFocus={() => setFocused(keyFor(group))} onBlur={() => setFocused('')}>
        <i style={{height:0,borderTop:`3px ${dash ? 'dashed' : 'solid'} ${color}`}} aria-hidden="true"/><strong>{byRegion ? group.region : group.year}</strong> · {group.samples.length}사례 · {dayLabel(first)} ~ {dayLabel(last)}
      </span></li>)}</ul>
    </div>}
    {small.length > 0 && <details><summary>{BOX_MINIMUM}사례 미만 그룹 {small.length}개</summary>
      <ul>{small.map(group => <li key={group.year+':'+group.regionCode}>{group.year}{group.region && ' · '+group.region} · {group.samples.length}사례</li>)}</ul>
    </details>}
  </dialog>
}
