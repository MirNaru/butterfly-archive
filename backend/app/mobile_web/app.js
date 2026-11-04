// 휴대폰의 선택 파일을 순서대로 읽고 실패한 전송만 재시도합니다.
import {inspectPhoto} from './metadata.js'
const $=id=>document.getElementById(id)
let items=[],busy=false,authenticated=false
async function api(path,body){
  const response=await fetch('/m/api/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json','X-Butterfly-Mobile':'1'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
  const value=await response.json().catch(()=>null)
  if(!response.ok){if(response.status===401){authenticated=false;showLogin()}throw new Error(typeof value?.detail==='string'?value.detail:'입력값과 연결 상태를 확인해 주세요.')}
  return value
}
function message(value){$('message').textContent=value}
function showLogin(){$('login').hidden=false;$('transfer').hidden=true}
function controls(){
  $('send').disabled=busy||!items.some(i=>i.metadata&&i.status==='ready')
  $('retry').disabled=busy||!items.some(i=>i.metadata&&i.status==='failed')
  $('clear').disabled=busy||!items.length;$('files').disabled=busy;$('original-files').disabled=busy;$('logout').disabled=busy
}
function render(){
  $('list').replaceChildren()
  for(const item of items){
    const article=document.createElement('article'),title=document.createElement('h3'),info=document.createElement('p'),state=document.createElement('p')
    title.textContent=item.name
    const m=item.metadata
    info.textContent=m?`촬영 ${m.taken_at_raw||'날짜 없음'}${m.offset_raw?' · '+m.offset_raw:' · 시간대 확인 필요'} / GPS ${m.latitude===null?'없음':m.latitude+', '+m.longitude}`:''
    state.textContent=({ready:'전송 대기',sending:'전송 중',sent:'PC 대기함에 전송 완료',duplicate:'이미 전송한 파일',failed:'전송 실패',invalid:'정보 읽기 실패'})[item.status]+(item.error?' · '+item.error:'')
    if(item.status==='failed'||item.status==='invalid')state.className='error'
    const route=document.createElement('p');route.textContent='선택 경로: '+(item.paths||[]).join(' / ');article.append(title,route,info,state)
    if(m?.warnings.length){const note=document.createElement('p');note.textContent=m.warnings.join(' / ');article.append(note)}
    $('list').append(article)
  }
  controls()
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;message('')
  try{await api('login',{code:$('code').value.trim().toUpperCase(),label:$('device').value.trim()||'내 휴대폰'});$('code').value='';await initialize()}catch(error){message(error.message)}finally{button.disabled=false}
})
async function initialize(){
  try{const session=await api('session');authenticated=true;$('identity').textContent=session.label+' · PC에 연결됨';$('login').hidden=true;$('transfer').hidden=false;message('');render()}catch{showLogin()}
}
async function readSelection(event,selection){
  const files=Array.from(event.target.files||[])
  if(files.length+items.length>500){message('한 번에 최대 500장까지 선택해 주세요.');event.target.value='';return}
  busy=true;controls();message('')
  for(let i=0;i<files.length;i++){
    $('progress').textContent=`정보 읽는 중 ${i+1} / ${files.length}`
    const file=files[i]
    try{const metadata=await inspectPhoto(file);const existing=items.find(item=>item.metadata?.sha256===metadata.sha256);if(existing){if(!existing.paths.includes(selection))existing.paths.push(selection)}else items.push({name:file.name,metadata,status:'ready',paths:[selection]})}
    catch(error){items.push({name:file.name,status:'invalid',error:error.message,paths:[selection]})}
    await new Promise(resolve=>setTimeout(resolve,0))
  }
  event.target.value='';busy=false;$('progress').textContent=`${items.length}장 · 날짜와 좌표를 확인한 뒤 전송해 주세요. 같은 파일은 선택 경로만 추가하고 중복 전송하지 않습니다.`;render()
}
$('files').addEventListener('change',event=>readSelection(event,'갤러리'))
$('original-files').addEventListener('change',event=>readSelection(event,'원본 파일'))
async function send(retry){
  if(busy)return
  const pending=items.filter(i=>i.metadata&&i.status===(retry?'failed':'ready'))
  busy=true;controls();message('')
  for(let index=0;index<pending.length;index++){
    const item=pending[index];item.status='sending';item.error='';render();$('progress').textContent=`전송 중 ${index+1} / ${pending.length}`
    try{const result=await api('photos',item.metadata);item.status=result.status==='duplicate'?'duplicate':'sent';if(result.existing_status==='discarded')item.error='PC 대기함에서 이전에 삭제한 자료입니다.';if(result.existing_status==='registered')item.error='관찰 기록에 이미 등록한 자료입니다.'}catch(error){item.status='failed';item.error=error.name==='TimeoutError'?'응답을 기다리지 못했습니다. 재시도하면 중복을 확인합니다.':error.message}
    if(!authenticated){for(const rest of pending.slice(index+1)){rest.status='failed';rest.error='로그인 후 다시 시도해 주세요.'}break}
  }
  busy=false;$('progress').textContent=`완료 ${items.filter(i=>['sent','duplicate'].includes(i.status)).length}장 · 실패 ${items.filter(i=>i.status==='failed').length}장`;render()
}
$('send').addEventListener('click',()=>send(false));$('retry').addEventListener('click',()=>send(true))
$('clear').addEventListener('click',()=>{items=[];$('progress').textContent='';render()})
$('logout').addEventListener('click',async()=>{try{await api('logout',{});authenticated=false;showLogin();message('로그아웃했습니다.')}catch(error){message(error.message)}})
window.addEventListener('beforeunload',event=>{if(busy||items.some(i=>['ready','failed'].includes(i.status))){event.preventDefault();event.returnValue=''}})
await initialize()
