// 실제 사이트나 개인 DB에 접근하지 않고 자동전송의 종료 조건을 검사합니다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const extraction = readFileSync(__dirname + '/extract.js', 'utf8').replaceAll('export function', 'function');
const code = extraction + '\n' + readFileSync(__dirname + '/background.js', 'utf8').replace("import { extractObservation, hasExcludedLocation } from './extract.js';", '').replace('export async function', 'async function');
async function scenario({ missing = false, repeat = false, fail = false, stop = false, privateRecords = false, missingRecords = false, transient = [], stopOnRetry = false } = {}) {
  let listener, job, writes = 0, stored = 0, moves = 0, current = 10;
  const sent = [];
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const chrome = {
    storage: {
      session: { get: async () => ({}), set: async value => { job = value.autoJob; if (!job.running) resolveDone(); else if (stopOnRetry && job.message.includes("재시도 대기")) await new Promise(resolve => listener({type:"auto-stop"}, {}, resolve)); } },
      local: { get: async () => ({ connectionKey: 'test' }), set: async () => {stored++;} },
    },
    runtime: { onMessage: { addListener: fn => { listener = fn; } } },
    tabs: {
      get: async () => ({ id: 1, url: `https://www.naturing.net/o/${current}`, status: 'complete' }),
      update: async (_id, { url }) => { current = Number(new URL(url).pathname.split('/')[2]); moves++; },
    },
    scripting: { executeScript: async ({ func }) => {
      if (stop && func.name === 'nextObservation') await new Promise(resolve => listener({type:'auto-stop'}, {}, resolve));
      return [{ result: func.name === 'nextObservation' ? (missing || current >= 15 ? null : `https://www.naturing.net/o/${repeat ? current : current + 1}`) : { source_id: String(current),place_raw:'경기 가평군',latitude:37,longitude:127, ...(privateRecords && current <= 12 ? {skip_reason:'private_location'} : {}), ...(missingRecords && current <= 12 ? {skip_reason:'missing_location'} : {}) } }];
    } },
  };
  vm.runInNewContext(code, {
    chrome, URL, Set, Date, AbortController, AbortSignal,
    setTimeout: fn => setImmediate(() => { if (stop && job?.running) listener({type:'auto-stop'}, {}, () => {}); fn(); }),
    fetch: async (_url, options) => {
      sent.push(JSON.parse(options.body).source_id);
      const status = transient[writes++] ?? (fail ? 401 : 200);
      if (status === 'timeout') throw new Error('시간 초과');
      return { status, ok: status === 200, json: async () => status === 200 ? { outcome: 'unchanged' } : { detail: '전송 실패' } };
    },
  });
  const response = await new Promise(resolve => listener({ type: 'auto-start', tabId: 1 }, {}, resolve));
  assert.equal(response.ok, true);
  await done;
  return { job, writes, stored, moves, sent };
}
test('세 건을 넘겨 다섯 건 전송한 뒤 다음 관찰이 없을 때 종료', async () => {
  const result = await scenario();
  assert.equal(result.moves, 5); assert.equal(result.writes, 5); assert.equal(result.job.completed, 5);
});
test('위치 비공개 두 건은 전송하지 않고 다음 공개 관찰을 계속 수집', async () => {
  const result=await scenario({privateRecords:true});
  assert.equal(result.moves,5); assert.equal(result.writes,3); assert.equal(result.job.skipped,2);
});

test('위치 미입력 두 건은 전송하지 않고 다음 위치 있는 관찰을 계속 수집',async()=>{
  const result=await scenario({missingRecords:true});
  assert.equal(result.moves,5);assert.equal(result.writes,3);assert.equal(result.stored,3);assert.equal(result.job.skipped,2);
});

function popupHarness(records,extracted,autoJob) {
  const elements=new Map(),sent=[];
  const storage={connectionKey:'test',...Object.fromEntries(records.map((r,i)=>[`observation:${i}`,r]))};
  const element=id=>{if(!elements.has(id))elements.set(id,{disabled:false,value:'',textContent:'',handlers:{},addEventListener(name,fn){this.handlers[name]=fn;},replaceChildren(){},append(){},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);};
  const context=vm.createContext({document:{querySelector:element,createElement:()=>({})},URL,AbortSignal,
    chrome:{storage:{local:{get:async key=>key==='connectionKey'?{connectionKey:storage.connectionKey}:{...storage},set:async()=>{},remove:async keys=>{for(const key of keys)delete storage[key];}},session:{get:async()=>({autoJob})},onChanged:{addListener(){}}},
      tabs:{query:async()=>[{id:1,url:'https://www.naturing.net/o/123'}]},scripting:{executeScript:async()=>[{result:extracted}]},runtime:{}},
    fetch:async(_url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({outcome:'created'})};},
  });
  const popup=readFileSync(__dirname+'/popup.js','utf8').replace("import { extractObservation, hasPrivateLocation, hasExcludedLocation } from './extract.js';",'');
  vm.runInContext(extraction+'\n'+popup,context);
  return {element,sent,storage};
}

test('비우기 취소는 자료를 보존하고 삭제 확인은 관찰 자료만 제거',async()=>{
  const h=popupHarness([{source_id:'1'},{source_id:'2'}],null);
  await h.element('#clear-archive').handlers.click();
  assert.equal(h.element('#clear-archive-dialog').open,true);
  assert.match(h.element('#clear-archive-count').textContent,/2건/);
  h.element('#clear-archive-cancel').handlers.click();
  assert.deepEqual(Object.keys(h.storage),['connectionKey','observation:0','observation:1']);
  await h.element('#clear-archive').handlers.click();
  await h.element('#clear-archive-confirm').handlers.click();
  assert.deepEqual(h.storage,{connectionKey:'test'});
  assert.deepEqual(h.sent,[]);
  assert.match(h.element('#clear-archive-status').textContent,/2건을 삭제/);
});

test('자동전송 중에는 보관 자료 비우기를 열 수 없음',async()=>{
  const h=popupHarness([{source_id:'1'}],null,{running:true});
  await Promise.resolve();
  assert.equal(h.element('#clear-archive').disabled,true);
  await h.element('#clear-archive').handlers.click();
  assert.equal(h.element('#clear-archive-dialog').open,undefined);
  assert.ok(h.storage['observation:0']);
});

test('보관 자료 일괄 전송도 실제 전송 직전에 위치 없는 자료를 제외',async()=>{
  const valid={source_id:'1',place_raw:'경기 가평군',latitude:37,longitude:127};
  const h=popupHarness([valid,{...valid,source_id:'2',place_raw:'정보가 없습니다.'},{...valid,source_id:'3',latitude:null}],null);
  await h.element('#send-all').handlers.click();
  assert.deepEqual(h.sent.map(r=>r.source_id),['1']);
  assert.match(h.element('#status').textContent,/2건 제외/);
});

test('구버전 추출 결과만 남은 경우 확장 갱신 안내',async()=>{
  const h=popupHarness([],{source_id:'123',skip_reason:'missing_location'});
  await h.element('#read').handlers.click();
  assert.equal(h.element('#save').disabled,true);
  assert.equal(h.element('#send').disabled,true);
  assert.match(h.element('#status').textContent,/확장을 새로고침/);
  assert.equal(h.sent.length,0);
});

test('수동 읽기는 비공개·미입력에서도 숨겨진 좌표 없이 종과 날짜를 읽음',()=>{
  for(const place of ['게시자의 요청에 따라 위치정보가 공개되지 않습니다.','정보가 없습니다.']) {
    const context=vm.createContext({location:{pathname:'/o/123',hostname:'www.naturing.net'},document:{
      querySelectorAll:s=>s==='h1'?[{innerText:'모시나비 Parnassius stubbendorfii',querySelector:()=>null}]:[{innerText:'관찰정보',parentElement:{innerText:`위치\n${place}\n고도\n정보가 없습니다.\n관찰시각\n2026년 5월 10일`}}],
      getElementById:()=>{throw Error('숨겨진 좌표 접근');}
    }});
    vm.runInContext(extraction,context);
    const r=vm.runInContext('extractObservation(true)',context);
    assert.equal(r.korean_name,'모시나비');assert.equal(r.observed_raw,'2026년 5월 10일');
    assert.equal(r.manual_capture,true);assert.equal(r.latitude,null);assert.equal(r.longitude,null);assert.equal(r.place_raw,'');
  }
});

test('명시적 수동 읽기 자료만 위치 없이 전송하고 오래된 위치 없는 자료는 제외',async()=>{
  const manual={source_id:'1',manual_capture:true,location_status:'private_location',place_raw:'',latitude:null,longitude:null};
  const h=popupHarness([manual,{...manual,source_id:'2',manual_capture:false}],manual);
  await h.element('#read').handlers.click();
  assert.equal(h.element('#save').disabled,false);assert.equal(h.element('#send').disabled,false);
  await h.element('#send-all').handlers.click();
  assert.deepEqual(h.sent.map(r=>r.source_id),['1']);
});

test('기존 보관 자료도 위치 미입력·좌표 누락·잘못된 좌표는 전송 제외',()=>{
  const context=vm.createContext({});vm.runInContext(extraction,context);
  for(const place of ['', '정보가 없습니다.', '위치 정보가 없습니다.', '위치를 입력하지 않았습니다.', '미입력']) {
    context.record={place_raw:place,latitude:37,longitude:127};
    assert.equal(vm.runInContext('hasExcludedLocation(record)',context),true,place);
  }
  for(const coords of [{latitude:null,longitude:127},{latitude:37,longitude:null},{latitude:NaN,longitude:127},{latitude:91,longitude:127}]) {
    context.record={place_raw:'경기 가평군',...coords};
    assert.equal(vm.runInContext('hasExcludedLocation(record)',context),true);
  }
  context.record={place_raw:'경기 가평군',latitude:37,longitude:127};
  assert.equal(vm.runInContext('hasExcludedLocation(record)',context),false);
});

test('위치 미입력 안내에서는 지도 기본 좌표도 읽지 않음',()=>{
  for(const place of ['', '정보가 없습니다.', '위치가 없습니다.']) {
    const context=vm.createContext({location:{pathname:'/o/123',hostname:'www.naturing.net'},document:{
      querySelectorAll:selector=>selector==='h1'?[{innerText:'모시나비 Parnassius stubbendorfii',querySelector:()=>null}]:[{innerText:'관찰정보',parentElement:{innerText:`위치\n${place}\n고도\n정보가 없습니다.`}}],
      getElementById:()=>{throw Error('미입력 위치의 지도 접근 시도');},
    }});
    vm.runInContext(extraction,context);
    assert.equal(vm.runInContext('extractObservation().skip_reason',context),'missing_location');
  }
});

test('실제 추출에서 공개 좌표 쌍을 확인하고 위치 있는 자료는 유지',()=>{
  for(const coords of [[null,null],['37',null],['37','127']]) {
    const context=vm.createContext({location:{pathname:'/o/123',hostname:'www.naturing.net'},document:{
      querySelectorAll:selector=>selector==='h1'?[{innerText:'모시나비 Parnassius stubbendorfii',querySelector:()=>null}]:[{innerText:'관찰정보',parentElement:{innerText:'위치\n경기 가평군\n고도\n10m\n관찰시각\n2026년 5월 10일 오전 10시'}}],
      getElementById:()=>({getAttribute:name=>name==='data-lat'?coords[0]:coords[1]}),
    }});
    vm.runInContext(extraction,context);
    assert.equal(vm.runInContext('extractObservation().skip_reason',context),coords.every(v=>v!==null)?undefined:'missing_location');
  }
});
test('기존 보관 자료의 위치 비공개 안내도 판별하고 단순 좌표 누락은 구분', () => {
  const context=vm.createContext({}); vm.runInContext(extraction,context);
  assert.equal(vm.runInContext("hasPrivateLocation({place_raw:'게시자의 요청에 따라 위치정보가 공개되지 않습니다.'})",context),true);
  assert.equal(vm.runInContext("hasPrivateLocation({place_raw:'위치 비공개'})",context),true);
  assert.equal(vm.runInContext("hasPrivateLocation({place_raw:'경기 가평군',latitude:null})",context),false);
});
test('비공개 안내가 있으면 지도 DOM에 남은 좌표도 읽지 않음', () => {
  const context=vm.createContext({
    location:{pathname:'/o/123',hostname:'www.naturing.net'},
    document:{
      querySelectorAll: selector => selector==='h1' ? [{innerText:'모시나비 Parnassius stubbendorfii',querySelector:()=>null}] : [{innerText:'관찰정보',parentElement:{innerText:'위치\n게시자의 요청에 따라 위치정보가 공개되지 않습니다.\n고도\n정보가 없습니다.'}}],
      getElementById:()=>{throw new Error('비공개 좌표 접근 시도');},
    },
  });
  vm.runInContext(extraction,context);
  assert.equal(vm.runInContext('extractObservation().skip_reason',context),'private_location');
});
test('다음 링크 없음과 반복 링크는 이동 없이 종료', async () => {
  for (const options of [{missing:true}, {repeat:true}]) {
    const result = await scenario(options);
    assert.equal(result.moves, 0); assert.equal(result.writes, 0);
  }
});
test('첫 전송 실패 후 추가 페이지를 요청하지 않음', async () => {
  const result = await scenario({fail:true});
  assert.equal(result.moves, 1); assert.equal(result.writes, 1); assert.equal(result.job.completed, 0);
});
test('대기 중 중지하면 이동 및 전송 없음', async () => {
  const result = await scenario({stop:true});
  assert.equal(result.moves, 0); assert.equal(result.writes, 0); assert.equal(result.job.running, false);
});

function navigationHarness() {
  let populated = false, callback, timeout;
  let links = [];
  const context = vm.createContext({
    chrome: { storage: {session: {get: async () => ({})}}, runtime: {onMessage: {addListener: () => {}}} },
    document: {
      getElementById: () => ({ querySelector: () => populated ? { getClientRects: () => [1] } : null }),
      querySelectorAll: () => links,
    },
    MutationObserver: class { constructor(fn) { callback = fn; } observe() {} disconnect() {} },
    setTimeout: fn => { timeout = fn; return 1; }, clearTimeout: () => {}, URL, Set,
  });
  vm.runInContext(code, context);
  return {
    run: () => vm.runInContext('nextObservation()', context),
    populate(next) {
      populated = true;
      links = next ? [{ textContent: '다음', getClientRects: () => [1], getAttribute: () => null, href: 'https://www.naturing.net/o/123?observation_name=test' }] : [];
      callback();
    },
    timeout: () => timeout(),
  };
}
test('본문 로드 후 늦게 추가된 다음 링크와 검색 조건을 기다림', async () => {
  const harness = navigationHarness();
  const pending = harness.run();
  harness.populate(true);
  assert.equal(await pending, 'https://www.naturing.net/o/123?observation_name=test');
});
test('탐색이 준비된 뒤 이전 링크만 있으면 마지막 관찰로 종료', async () => {
  const harness = navigationHarness();
  const pending = harness.run();
  harness.populate(false);
  assert.equal(await pending, null);
});
test('탐색 로딩 실패를 다음 관찰 없음과 구분', async () => {
  const harness = navigationHarness();
  const pending = harness.run();
  harness.timeout();
  await assert.rejects(pending, /링크가 아직 준비되지/);
});

test('일시적인 로컬 저장 오류와 응답 유실 후 같은 관찰부터 이어서 전송', async () => {
  const result = await scenario({ transient: [503, 'timeout'] });
  assert.deepEqual(result.sent, ['11', '11', '11', '12', '13', '14', '15']);
  assert.equal(result.job.completed, 5);
  assert.equal(result.stored, 5);
});

test('재시도 한도를 넘으면 현재 관찰을 보관하고 다음 관찰로 이동하지 않음', async () => {
  const result = await scenario({ transient: [503, 503, 503] });
  assert.deepEqual(result.sent, ['11', '11', '11']);
  assert.equal(result.moves, 1);
  assert.equal(result.stored, 1);
  assert.equal(result.job.completed, 0);
});

test('재시도 대기 중 사용자 중지는 다음 전송을 막음', async () => {
  const result = await scenario({ transient: [503], stopOnRetry: true });
  assert.deepEqual(result.sent, ['11']);
  assert.match(result.job.message, /사용자가 중지/);
});
