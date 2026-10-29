// 사용자가 시작한 다음 관찰의 연속 이동과 로컬 DB 전송을 담당합니다.
import { extractObservation, hasPrivateLocation } from './extract.js';

const endpoint = 'http://127.0.0.1:8000/api/collection/naturing';
let activeJob = null;
const ready = chrome.storage.session.get('autoJob').then(async ({ autoJob }) => {
  if (autoJob?.running) await chrome.storage.session.set({ autoJob: { ...autoJob, running: false, message: `${autoJob.completed}건 처리 후 실행이 중단됐습니다. 페이지를 확인한 뒤 다시 시작하세요.` } });
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function observationId(value) {
  const url = new URL(value);
  if (url.origin !== 'https://www.naturing.net' || !/^\/o\/[1-9]\d*\/?$/.test(url.pathname)) throw new Error('네이처링 관찰 상세 페이지에서 시작해 주세요.');
  return url.pathname.split('/')[2];
}
// 사진 화살표가 아닌 상단의 다음 관찰 링크만 사용합니다.
export async function nextObservation() {
  // 본문 load 완료와 별개로 비동기 요청이 탐색 링크를 채웁니다.
  const container = document.getElementById('navPrevNext');
  if (!container) throw new Error('관찰 탐색 영역을 찾지 못했습니다.');
  const populated = () => container.querySelector('a.nav-prev-next__item');
  if (!populated()) await new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => { if (populated()) complete(); });
    let timer;
    function complete(error) {
      observer.disconnect(); clearTimeout(timer);
      if (error) reject(error); else resolve();
    }
    observer.observe(container, { childList: true, subtree: true });
    timer = setTimeout(() => complete(new Error('이전·다음 링크가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.')), 20000);
    if (populated()) complete();
  });
  const links = [...document.querySelectorAll('a.nav-prev-next__item--next')].filter(a => a.textContent.trim().startsWith('다음') && a.getClientRects().length && a.getAttribute('aria-disabled') !== 'true');
  const urls = [...new Set(links.map(a => a.href))];
  if (!urls.length) {
    const previous = container.querySelector('a.nav-prev-next__item--prev');
    if (previous && previous.getClientRects().length) return null;
    throw new Error('이전·다음 탐색 상태를 확인하지 못했습니다.');
  }
  if (urls.length !== 1) throw new Error('다음 관찰 링크를 하나로 확인하지 못했습니다.');
  const url = new URL(urls[0]);
  if (url.origin !== 'https://www.naturing.net' || !/^\/o\/[1-9]\d*\/?$/.test(url.pathname)) throw new Error('다음 관찰 주소가 올바르지 않습니다.');
  return url.href;
}
async function update(job, message) {
  if (activeJob !== job) return;
  message += ` · 위치 비공개 ${job.skipped}건 제외`;
  job.message = message;
  await chrome.storage.session.set({ autoJob: { running: true, completed: job.completed, message } });
}
async function finish(job, message) {
  if (activeJob !== job) return;
  activeJob = null;
  await chrome.storage.session.set({ autoJob: { running: false, completed: job.completed, skipped:job.skipped, message:message + ` · 위치 비공개 ${job.skipped}건 제외` } });
}
async function run(job) {
  const visited = new Set([job.startId]);
  let expectedId = job.startId;
  try {
    while (activeJob === job) {
      await update(job, `${job.completed}건 전송 완료 · 다음 관찰 확인 중`);
      const before = await chrome.tabs.get(job.tabId);
      if (observationId(before.url) !== expectedId) throw new Error('다른 페이지로 이동하여 중단했습니다.');
      const [next] = await chrome.scripting.executeScript({ target: { tabId: job.tabId }, func: nextObservation });
      if (!next?.result) { await finish(job, `${job.completed}건 전송 완료 · 다음 관찰이 없어 종료했습니다.`); return; }
      const targetId = observationId(next.result);
      if (visited.has(targetId)) throw new Error('이미 방문한 관찰로 이어져 중단했습니다.');
      visited.add(targetId);
      await update(job, `${job.completed}건 전송 완료 · 다음 관찰로 이동 중`);
      if (activeJob !== job) return;
      if (observationId((await chrome.tabs.get(job.tabId)).url) !== expectedId) throw new Error('대기 중 다른 페이지로 이동하여 중단했습니다.');
      await chrome.tabs.update(job.tabId, { url: next.result });
      const deadline = Date.now() + 25000;
      let loaded = false;
      while (activeJob === job && Date.now() < deadline) {
        await delay(500);
        const tab = await chrome.tabs.get(job.tabId);
        if (observationId(tab.url) !== targetId) throw new Error('예상과 다른 페이지로 이동했습니다.');
        if (tab.status === 'complete') { loaded = true; break; }
      }
      if (activeJob !== job) return;
      if (!loaded) throw new Error('페이지를 불러오는 시간이 초과됐습니다.');
      expectedId = targetId;
      const [extracted] = await chrome.scripting.executeScript({ target: { tabId: job.tabId }, func: extractObservation });
      const record = extracted?.result;
      if (!record || record.source_id !== targetId) throw new Error('이동한 관찰 정보를 확인하지 못했습니다.');
      if (activeJob !== job) return;
      if (hasPrivateLocation(record)) { job.skipped++; continue; }
      await chrome.storage.local.set({ [`observation:${record.source_id}`]: record });
      const { connectionKey } = await chrome.storage.local.get('connectionKey');
      if (!connectionKey) throw new Error('앱 연결 키를 저장해 주세요.');
      if (activeJob !== job) return;
      job.controller = new AbortController();
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connectionKey}` }, body: JSON.stringify(record), signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(15000)]) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '전송 자료를 확인해 주세요.');
      if (!['created', 'updated', 'unchanged'].includes(result.outcome)) throw new Error('DB 응답을 확인하지 못했습니다.');
      job.completed++;
    }
  } catch (error) { await finish(job, `${job.completed}건 전송 완료 후 중단 · ${error.message}`); }
}
chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (!['auto-start', 'auto-stop'].includes(message.type)) return;
  void (async () => {
    await ready;
    if (message.type === 'auto-stop') {
      if (activeJob) {
        const job = activeJob;
        job.controller?.abort();
        await finish(job, `${job.completed}건 전송 완료 · 사용자가 중지했습니다. 전송 중이던 한 건은 DB에 반영됐을 수 있습니다.`);
      }
      respond({ ok: true }); return;
    }
    if (activeJob) throw new Error('자동전송이 이미 진행 중입니다.');
    const { connectionKey } = await chrome.storage.local.get('connectionKey');
    if (!connectionKey) throw new Error('앱 연결 키를 먼저 저장해 주세요.');
    const tab = await chrome.tabs.get(message.tabId);
    const job = { tabId: tab.id, startId: observationId(tab.url), completed: 0, skipped:0 };
    activeJob = job;
    await update(job, '0건 · 자동전송을 시작합니다.');
    respond({ ok: true });
    void run(job);
  })().catch(error => respond({ error: error.message }));
  return true;
});
