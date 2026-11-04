// 이미 전달받은 조회 사본 안에서만 검색·필터합니다. 관찰 저장·삭제 API는 없습니다.
const $=id=>document.getElementById(id)
const stage={unknown:'미상',egg:'알',larva:'애벌레',pupa:'번데기',adult:'어른벌레'}
const sex={unknown:'미상',male:'수컷',female:'암컷',mixed:'혼합'}
const acquisition={unknown:'미확인',own_capture:'직접 채집',purchase:'구매',other:'기타'}
let snapshot=null,tab='records',page=0
async function api(path,body){
 const response=await fetch('/viewer/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Butterfly-Viewer':'1'},credentials:'same-origin',body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
 const value=await response.json()
 if(!response.ok){if(response.status===401){snapshot=null;$('viewer').hidden=true;$('login').hidden=false;$('list').replaceChildren()}throw new Error(value.detail||'조회 실패')}
 return value
}
function node(tag,text){const element=document.createElement(tag);element.textContent=text??'';return element}
function paragraph(container,label,value){if(value!==null&&value!==undefined&&value!=='')container.append(node('p',label+': '+(Array.isArray(value)?value.join(' · '):value)))}
function range(period){
 const slot=n=>`${Math.floor((n-1)/3)+1}월 ${['초순','중순','말순'][(n-1)%3]}`
 const day=n=>{const d=new Date(Date.UTC(2000,0,n));return `${d.getUTCMonth()+1}월 ${d.getUTCDate()}일`}
 return `${period.start_day?day(period.start_day):slot(period.start)} ~ ${period.end_day?day(period.end_day):slot(period.end)}${period.region?' · '+period.region:''}`
}
export function matchesViewer(item,kind,filters,species){
 const info=kind==='catalog'?item:species.get(item.species_id),reference=info?.reference
 if(filters.family&&reference?.family!==filters.family)return false
 if(kind==='records'){
  if(filters.stage&&item.stage!==filters.stage)return false
  if(filters.source&&item.source_type!==filters.source)return false
 }
 if(kind!=='catalog'){
  const date=kind==='records'?item.effective_date:item.acquired_date
  if(filters.start&&(!date||date<filters.start))return false
  if(filters.end&&(!date||date>filters.end))return false
 }
 const text=JSON.stringify([item,info?.name,info?.scientific_name,reference?.regions,reference?.region_search]).toLowerCase()
 return !filters.query||text.includes(filters.query.trim().toLowerCase())
}
function render(){
 if(!snapshot)return
 const species=new Map(snapshot.catalog.map(s=>[s.id,s]))
 const filters=Object.fromEntries(['query','family','stage','source','start','end'].map(k=>[k,$(k).value]))
 const items=snapshot[tab].filter(item=>matchesViewer(item,tab,filters,species)),pages=Math.max(1,Math.ceil(items.length/30))
 page=Math.min(page,pages-1);$('count').textContent=`검색 ${items.length}건 / 전체 ${snapshot[tab].length}건`
 $('list').replaceChildren()
 for(const item of items.slice(page*30,(page+1)*30)){
  const speciesInfo=tab==='catalog'?item:species.get(item.species_id),article=node('article','')
  article.append(node('h2',speciesInfo?.name||item.species_name||item.korean_name||'종 미확정'));paragraph(article,'학명',speciesInfo?.scientific_name||item.scientific_name)
  if(tab==='records'){
   paragraph(article,'관찰',item.effective_date+(item.observation_time?' '+item.observation_time:''));paragraph(article,'출처',item.source_type==='direct'?'직접 관찰':'간접 관찰');paragraph(article,'성장 단계',stage[item.stage]);paragraph(article,'성별',sex[item.sex]);paragraph(article,'장소',item.display_place||item.effective_place);paragraph(article,'좌표',item.effective_latitude===null?'미입력':item.effective_latitude+', '+item.effective_longitude);paragraph(article,'개체 수',item.count??'미상');paragraph(article,'태그',item.effective_tags);paragraph(article,'근거',item.source_note);paragraph(article,'메모',item.notes)
  }else if(tab==='catalog'){
   const r=item.reference;paragraph(article,'분류',[r.family,r.subfamily].filter(Boolean));paragraph(article,'기주식물',r.host_plants);paragraph(article,'서식지',r.habitat);paragraph(article,'출현지역',r.regions)
   const more=document.createElement('details');more.append(node('summary','한살이·동정·세부 정보'))
   for(const p of r.lifecycle||[])if(p.enabled)paragraph(more,stage[p.stage]||'성장 단계',range(p))
   paragraph(more,'습성',r.habits);paragraph(more,'동정 포인트',r.identification_points);paragraph(more,'기타 메모',r.other_notes)
   for(const entry of r.details||[])paragraph(more,entry.title||entry.category,[entry.body,entry.source,entry.timing].filter(Boolean).join(' · '))
   article.append(more)
  }else{
   paragraph(article,'취득',acquisition[item.acquisition]);paragraph(article,'날짜',item.acquired_date);paragraph(article,'성별',sex[item.sex]);paragraph(article,'소지',({owned:'소지함',not_owned:'소지하지 않음',unknown:'미확인'})[item.possession]);paragraph(article,'수량',item.quantity??'미상');paragraph(article,'수컷 수량',item.male_quantity);paragraph(article,'암컷 수량',item.female_quantity);paragraph(article,'근거',item.source_note);paragraph(article,'메모',item.notes)
  }
  $('list').append(article)
 }
 $('page').textContent=`${page+1} / ${pages}`;$('previous').disabled=page===0;$('next').disabled=page+1>=pages
 for(const id of ['stage-label','source-label'])$(id).hidden=tab!=='records'
 for(const id of ['start-label','end-label'])$(id).hidden=tab==='catalog'
}
async function load(){
 $('message').textContent='조회용 사본을 읽는 중입니다.'
 try{snapshot=await api('data');$('updated').textContent='사본 갱신 '+new Date(snapshot.generated_at).toLocaleString('ko-KR');$('login').hidden=true;$('viewer').hidden=false;const chosen=$('family').value;$('family').replaceChildren(new Option('전체',''));for(const family of new Set(snapshot.catalog.map(s=>s.reference.family).filter(Boolean)))$('family').append(new Option(family,family));$('family').value=chosen;page=0;render();$('message').textContent=''}catch(error){$('message').textContent=error.message}
}
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{await api('login',{code:$('code').value.trim().toUpperCase(),label:'내 조회 기기'});$('code').value='';await load()}catch(error){$('message').textContent=error.message}finally{button.disabled=false}})
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{tab=button.dataset.tab;page=0;for(const b of document.querySelectorAll('[data-tab]'))b.setAttribute('aria-pressed',String(b===button));render()})
for(const key of ['query','family','stage','source','start','end'])$(key).addEventListener('input',()=>{page=0;render()})
$('reset').addEventListener('click',()=>{for(const key of ['query','family','stage','source','start','end'])$(key).value='';page=0;render()})
$('refresh').addEventListener('click',load)
$('previous').addEventListener('click',()=>{page--;render()});$('next').addEventListener('click',()=>{page++;render()})
$('logout').addEventListener('click',async()=>{try{await api('logout',{});snapshot=null;$('list').replaceChildren();$('viewer').hidden=true;$('login').hidden=false;$('message').textContent='로그아웃했습니다.'}catch(error){$('message').textContent=error.message}})
try{await api('session');await load()}catch{$('login').hidden=false}
