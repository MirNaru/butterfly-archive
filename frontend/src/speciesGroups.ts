// 검색 조건에 맞는 관찰을 종별로 묶고 직접 관찰 지역과 최근 날짜를 요약합니다.
import type { RecordRow } from './recordSearch'
export function groupSpecies(rows:RecordRow[], query:string,ranks:Map<number,number>=new Map()) {
  const groups=new Map<number,{id:number;name:string;rows:RecordRow[]}>()
  for(const row of rows) {
    const id=row.record.species_id??-1
    if(!groups.has(id))groups.set(id,{id,name:row.record.species_name||'동정 미확정',rows:[]})
    groups.get(id)!.rows.push(row)
  }
  return [...groups.values()].map(group=>{
    const ordered=[...group.rows].sort((a,b)=>Number(b.record.source_type==='direct')-Number(a.record.source_type==='direct')||b.record.effective_date.localeCompare(a.record.effective_date))
    const regions=[...new Set(ordered.map(r=>r.record.administrative_region||'').filter(Boolean))]
    const needle=query.trim().toLowerCase()
    const matching=new Set(ordered.filter(r=>needle&&(r.record.place_search||r.record.administrative_region||'').toLowerCase().includes(needle)).map(r=>r.record.administrative_region))
    const counts = new Map<string,number>()
    for (const r of group.rows) if (r.record.result === 'observed' && r.record.administrative_region) counts.set(r.record.administrative_region,(counts.get(r.record.administrative_region)||0)+1)
    regions.sort((a,b)=>(counts.get(b)||0)-(counts.get(a)||0)||Number(matching.has(b))-Number(matching.has(a)))
    const observed=group.rows.filter(r=>r.record.result==='observed')
    return {...group,regions,observed:observed.length,direct:observed.filter(r=>r.record.source_type==='direct').length,
      indirect:observed.filter(r=>r.record.source_type==='indirect').length,notFound:group.rows.length-observed.length,
      latest:observed.map(r=>r.record.effective_date).sort().at(-1)||''}
  }).sort((a,b)=>(ranks.get(a.id)??Number.MAX_SAFE_INTEGER)-(ranks.get(b.id)??Number.MAX_SAFE_INTEGER)||a.name.localeCompare(b.name,'ko'))
}
