// 출현 행정지역을 권역·시도별 체크박스로 관리하며 원문과 관찰 근거를 표시합니다.
import { useEffect, useRef, useState } from 'react'
import { listRegions } from './api'
import type { AdministrativeRegion } from './api'
import type { SpeciesReference } from './models'

function Check({checked,partial,onChange,label}:{checked:boolean;partial:boolean;onChange:()=>void;label:string}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(()=>{if(input.current) input.current.indeterminate=partial},[partial])
  return <label className="check"><input ref={input} type="checkbox" checked={checked} onChange={onChange}/>{label}</label>
}
export default function RegionPicker({value,onChange,evidence}:{value:string[];onChange:(codes:string[])=>void;evidence:NonNullable<SpeciesReference['region_evidence']>}) {
  const [regions,setRegions]=useState<AdministrativeRegion[]>([]), [error,setError]=useState(''), [retry,setRetry]=useState(0)
  useEffect(()=>{let active=true;listRegions().then(r=>{if(active){setRegions(r.regions);setError('')}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[retry])
  const selected=new Set(value)
  const isSelected=(code:string)=>selected.has(code)||(code.length>2&&selected.has(code.slice(0,2)))
  const toggle=(codes:string[])=>{
    if(codes.length===1&&codes[0].length>2&&selected.has(codes[0].slice(0,2))) {
      const parent=codes[0].slice(0,2)
      onChange([...new Set([...value.filter(c=>c!==parent&&c!==codes[0]),...regions.filter(r=>r.level==='sigungu'&&r.code.startsWith(parent)&&r.code!==codes[0]).map(r=>r.code)])]);return
    }
    onChange(codes.every(isSelected)?value.filter(c=>!codes.includes(c)):[...new Set([...value,...codes])])
  }
  return <section className="region-picker"><h3>출현 행정지역</h3><p className="hint">엑셀 참고 지역과 사용자 확인 관찰을 합산합니다. 체크를 해제한 지역은 새 관찰이 있어도 자동으로 다시 선택하지 않습니다.</p>
    {error&&<p className="error" role="alert">{error}<button type="button" onClick={()=>setRetry(n=>n+1)}>지역 목록 다시 읽기</button></p>}
    {!regions.length&&!error&&<p role="status">행정지역을 읽는 중입니다.</p>}
    {['수도권','강원도','충청권','전라권','경상권','제주'].map(group=>{
      const children=regions.filter(r=>r.group===group), codes=children.map(r=>r.code), count=codes.filter(isSelected).length
      return <details key={group}><summary>{group==='강원도'?'강원특별자치도':group} · {count}개 선택</summary><Check checked={count===codes.length&&!!count} partial={count>0&&count<codes.length} onChange={()=>toggle(codes)} label={`${group} 전체 선택·해제`}/>
        {children.filter(r=>r.level==='special').map(r=><label key={r.code} className="check"><input type="checkbox" checked={selected.has(r.code)} onChange={()=>onChange(selected.has(r.code)?value.filter(c=>c!==r.code):[...value,r.code])}/>{r.name} · 사용자 지정 참고 지역</label>)}
        {children.filter(r=>r.level==='sido').map(province=>{const codes=children.filter(r=>r.code.startsWith(province.code)).map(r=>r.code);const all=codes.every(isSelected);return <details key={province.code}><summary>{province.name}</summary><Check checked={all} partial={!all&&codes.some(isSelected)} onChange={()=>toggle(codes)} label={`${province.name} 전체 선택·해제`}/><div className="region-options">{children.filter(r=>r.level==='sigungu'&&r.code.startsWith(province.code)).map(r=><label className="check" key={r.code}><input type="checkbox" checked={isSelected(r.code)} onChange={()=>toggle([r.code])}/>{r.name}</label>)}</div></details>})}
      </details>
    })}
    {evidence.length>0&&<details><summary>지역 근거 · {evidence.length}건</summary><ul>{evidence.map((e,i)=><li key={i}>{regions.find(r=>r.code===e.code)?.label||e.code} · {({excel:'엑셀',manual:'사용자 지정',observation:'관찰 확인'})[e.origin]} · {e.detail}</li>)}</ul></details>}
  </section>
}
