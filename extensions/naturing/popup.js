import { extractObservation, hasPrivateLocation } from './extract.js';
// 현재 탭의 공개 DOM을 읽고 사용자 확인 후 확장 로컬 저장소에 보관합니다.
let current = null;
const status = document.querySelector('#status');
const read = document.querySelector('#read');
const save = document.querySelector('#save');
const preview = document.querySelector('#preview');
let sending = false;
const send = document.querySelector('#send');
const sendAll = document.querySelector('#send-all');
document.querySelector('#connect').addEventListener('click', async () => {
  const input = document.querySelector('#connection-key');
  const key = input.value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) { status.textContent = '앱에서 발급한 연결 키 전체를 입력해 주세요.'; return; }
  try { await chrome.storage.local.set({ connectionKey: key }); input.value = ''; status.textContent = '연결 키를 저장했습니다. DB 전송 버튼으로 자료를 보낼 수 있습니다.'; }
  catch (error) { status.textContent = error.message; }
});
async function transmit(records) {
  if (sending) return;
  sending = true; send.disabled = true; sendAll.disabled = true; read.disabled = true;
  let completed = 0;
  const excluded = records.filter(hasPrivateLocation).length;
  records = records.filter(record => !hasPrivateLocation(record));
  const counts = { created: 0, updated: 0, unchanged: 0 };
  try {
    const { connectionKey } = await chrome.storage.local.get('connectionKey');
    if (!connectionKey) throw new Error('앱에서 연결 키를 발급하고 연결 설정에 저장해 주세요.');
    if (!records.length) throw new Error(`전송할 자료가 없습니다. 위치 비공개 ${excluded}건을 제외했습니다.`);
    for (const record of records) {
      const response = await fetch('http://127.0.0.1:8000/api/collection/naturing', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connectionKey}` }, body: JSON.stringify(record), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '입력 자료를 확인해 주세요.');
      if (!Object.hasOwn(counts, result.outcome)) throw new Error('서버 응답을 확인하지 못했습니다.');
      counts[result.outcome]++; completed++;
      status.textContent = `${completed} / ${records.length}건 전송 완료`;
    }
    status.textContent = `DB 저장 완료: 신규 ${counts.created} · 변경 ${counts.updated} · 동일 ${counts.unchanged}건 · 위치 비공개 ${excluded}건 제외. 앱에서 목록을 새로고침하세요.`;
  } catch (error) { status.textContent = `${completed}건 전송 완료 후 중단. ${error.message}\n앱 실행과 연결 키를 확인한 뒤 다시 전송하세요. 보관 자료는 유지됩니다.`; }
  finally { sending = false; send.disabled = !current; sendAll.disabled = false; read.disabled = false; }
}
send.addEventListener('click', () => { if (current) void transmit([current]); });
sendAll.addEventListener('click', async () => {
  try { const items = await chrome.storage.local.get(null); await transmit(Object.entries(items).filter(([key]) => key.startsWith('observation:')).map(([, value]) => value)); }
  catch (error) { status.textContent = error.message; }
});


read.addEventListener('click', async () => {
  read.disabled = true; save.disabled = true; document.querySelector('#send').disabled = true; current = null; preview.replaceChildren();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    if (url.origin !== 'https://www.naturing.net' || !/^\/o\/\d+\/?$/.test(url.pathname)) throw new Error('네이처링 관찰 상세 페이지에서 실행해 주세요.');
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractObservation });
    if (!result?.result) throw new Error('페이지를 읽지 못했습니다.');
    if (hasPrivateLocation(result.result)) { status.textContent = '게시자 요청으로 위치가 비공개인 기록은 가져오지 않습니다.'; return; }
    current = result.result;
    for (const [key, label] of Object.entries({ korean_name:'국명', scientific_name:'학명', observed_raw:'관찰시각', place_raw:'장소', latitude:'공개 위도', longitude:'공개 경도', altitude_raw:'고도', weather_raw:'기상', url:'출처' })) {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = String(current[key] ?? '') || '정보 없음'; preview.append(dt, dd);
    }
    save.disabled = false; document.querySelector('#send').disabled = false; status.textContent = '원문과 비교한 후 보관해 주세요. 위치 정확도는 미상입니다.';
  } catch (error) { status.textContent = error.message; }
  finally { read.disabled = false; }
});
save.addEventListener('click', async () => {
  if (!current) return;
  save.disabled = true;
  try {
    await chrome.storage.local.set({ [`observation:${current.source_id}`]: current });
    status.textContent = '보관했습니다. 같은 기록 번호는 최신 추출 내용으로 갱신됩니다.';
  } catch (error) { status.textContent = error.message; save.disabled = false; }
});
document.querySelector('#export').addEventListener('click', async () => {
  try {
    const items = await chrome.storage.local.get(null);
    const records = Object.entries(items).filter(([key]) => key.startsWith('observation:')).map(([, value]) => value);
    if (!records.length) { status.textContent = '보관된 자료가 없습니다.'; return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'butterfly-naturing-v1', records }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'naturing-observations.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { status.textContent = error.message; }
});

const autoStart = document.querySelector('#auto-start');
const autoStop = document.querySelector('#auto-stop');
const autoStatus = document.querySelector('#auto-status');
function showJob(job) {
  const running = Boolean(job?.running);
  autoStart.disabled = running; autoStop.disabled = !running;
  for (const button of [read, sendAll, document.querySelector('#connect')]) button.disabled = running;
  send.disabled = running || !current; save.disabled = running || !current;
  autoStatus.textContent = job?.message || '다음 관찰이 없어질 때까지 이동하며 전송합니다.';
}
chrome.storage.session.get('autoJob').then(({autoJob}) => showJob(autoJob));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.autoJob) showJob(changes.autoJob.newValue);
});
autoStart.addEventListener('click', async () => {
  autoStart.disabled = true;
  try {
    if (sending) throw new Error('현재 전송이 끝난 뒤 시작해 주세요.');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.runtime.sendMessage({ type: 'auto-start', tabId: tab.id });
    if (result.error) throw new Error(result.error);
  } catch (error) { autoStatus.textContent = error.message; autoStart.disabled = false; }
});
autoStop.addEventListener('click', async () => {
  try { await chrome.runtime.sendMessage({ type: 'auto-stop' }); }
  catch (error) { autoStatus.textContent = error.message; }
});
