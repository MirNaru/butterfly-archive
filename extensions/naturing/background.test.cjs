// 실제 사이트나 개인 DB에 접근하지 않고 자동전송의 종료 조건을 검사합니다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const extraction = readFileSync(__dirname + '/extract.js', 'utf8').replaceAll('export function', 'function');
const code = extraction + '\n' + readFileSync(__dirname + '/background.js', 'utf8').replace("import { extractObservation, hasPrivateLocation } from './extract.js';", '').replace('export async function', 'async function');
async function scenario({ missing = false, repeat = false, fail = false, stop = false, privateRecords = false } = {}) {
  let listener, job, writes = 0, moves = 0, current = 10;
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const chrome = {
    storage: {
      session: { get: async () => ({}), set: async value => { job = value.autoJob; if (!job.running) resolveDone(); } },
      local: { get: async () => ({ connectionKey: 'test' }), set: async () => {} },
    },
    runtime: { onMessage: { addListener: fn => { listener = fn; } } },
    tabs: {
      get: async () => ({ id: 1, url: `https://www.naturing.net/o/${current}`, status: 'complete' }),
      update: async (_id, { url }) => { current = Number(new URL(url).pathname.split('/')[2]); moves++; },
    },
    scripting: { executeScript: async ({ func }) => {
      if (stop && func.name === 'nextObservation') await new Promise(resolve => listener({type:'auto-stop'}, {}, resolve));
      return [{ result: func.name === 'nextObservation' ? (missing || current >= 15 ? null : `https://www.naturing.net/o/${repeat ? current : current + 1}`) : { source_id: String(current), ...(privateRecords && current <= 12 ? {skip_reason:'private_location'} : {}) } }];
    } },
  };
  vm.runInNewContext(code, {
    chrome, URL, Set, Date, AbortController, AbortSignal,
    setTimeout: fn => setImmediate(() => { if (stop && job?.running) listener({type:'auto-stop'}, {}, () => {}); fn(); }),
    fetch: async () => { writes++; return { ok: !fail, json: async () => fail ? { detail: '전송 실패' } : { outcome: 'created' } }; },
  });
  const response = await new Promise(resolve => listener({ type: 'auto-start', tabId: 1 }, {}, resolve));
  assert.equal(response.ok, true);
  await done;
  return { job, writes, moves };
}
test('세 건을 넘겨 다섯 건 전송한 뒤 다음 관찰이 없을 때 종료', async () => {
  const result = await scenario();
  assert.equal(result.moves, 5); assert.equal(result.writes, 5); assert.equal(result.job.completed, 5);
});
test('위치 비공개 두 건은 전송하지 않고 다음 공개 관찰을 계속 수집', async () => {
  const result=await scenario({privateRecords:true});
  assert.equal(result.moves,5); assert.equal(result.writes,3); assert.equal(result.job.skipped,2);
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
