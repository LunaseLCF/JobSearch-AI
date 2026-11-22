import { setTimeout as delay } from 'timers/promises';

const BASE = 'http://localhost:3100';
async function api(path, method = 'GET', body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
function assert(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) process.exitCode = 1;
}

const original = await api('/api/llm-config');
const mockModel = {
  id: 'lang-mock', label: 'Language verification mock', provider: 'OpenAI',
  apiKey: 'test-key', model: 'mock-model', baseUrl: 'http://127.0.0.1:4103/v1', enabled: true,
};

const targets = await (await fetch('http://localhost:9225/json/list')).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = event => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const evaluate = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expression, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return true;
    await delay(250);
  }
  return false;
};

try {
  await api('/api/llm-config', 'POST', { models: [mockModel], activeModelId: 'lang-mock' });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.navigate', { url: 'http://localhost:3100/?langcheck=' + Date.now() });
  await waitFor("!!document.querySelector('[data-page=\"interview\"]')");

  console.log('--- 1. Chinese UI -> Interview Prep ---');
  await evaluate("setLanguage('cn')");
  await delay(800);
  await evaluate("document.querySelector('[data-page=\"interview\"]').click()");
  await waitFor("!!document.getElementById('int-company')");
  await evaluate(`(() => {
    document.getElementById('int-company').value = '测试公司';
    document.getElementById('int-role').value = '工程师';
    document.getElementById('int-posting').value = '需要中文沟通能力';
    generateInterviewPrep();
    return true;
  })()`);
  await waitFor("document.getElementById('int-results').innerText.includes('中文面试问题')");
  const cnPrep = await evaluate("document.getElementById('int-results').innerText");
  console.log('Interview output (CN):', JSON.stringify(cnPrep.slice(0, 400)));
  assert(cnPrep.includes('中文STAR标题') && cnPrep.includes('中文面试问题'), 'Interview Prep output is Chinese');
  assert(!cnPrep.includes('English STAR title') && !cnPrep.includes('English interview question'), 'No English AI content leaked');
  const enRequest = await (await fetch('http://localhost:4103/last')).json();
  const promptText = [enRequest.system, ...((enRequest.messages || []).map(m => m.content))].join('\n');
  assert(/Write ALL user-facing text in Simplified Chinese\./.test(promptText), 'AI prompt explicitly requested Simplified Chinese');

  console.log('\n--- 2. Chinese UI -> Apply Workflow tailoring ---');
  await evaluate("document.querySelector('[data-page=\"apply\"]').click()");
  await waitFor("!!document.getElementById('apply-company')");
  await evaluate(`(() => {
    document.getElementById('apply-company').value = '测试公司';
    document.getElementById('apply-role').value = '工程师';
    document.getElementById('apply-posting').value = '需要中文沟通能力';
    analyzeAndTailor();
    return true;
  })()`);
  await waitFor("(document.getElementById('tailor-summary')?.value || '').includes('中文定制摘要')");
  const cnTailor = await evaluate(`({
    text: document.getElementById('apply-tailoring').innerText,
    summary: document.getElementById('tailor-summary')?.value || '',
    highlights: document.getElementById('tailor-highlights')?.value || ''
  })`);
  console.log('Tailoring output (CN):', JSON.stringify(cnTailor));
  assert(cnTailor.summary.includes('中文定制摘要') && cnTailor.highlights.includes('中文亮点'), 'Tailoring summary and highlights are Chinese');
  assert(!cnTailor.summary.includes('English tailored summary'), 'No English tailoring text leaked');

  console.log('\n--- 3. English UI still produces English ---');
  await evaluate("setLanguage('en')");
  await delay(800);
  await evaluate("document.querySelector('[data-page=\"interview\"]').click()");
  await waitFor("!!document.getElementById('int-company')");
  await evaluate(`(() => {
    document.getElementById('int-company').value = 'Acme';
    document.getElementById('int-role').value = 'Engineer';
    document.getElementById('int-posting').value = 'Build systems';
    generateInterviewPrep();
    return true;
  })()`);
  await waitFor("document.getElementById('int-results').innerText.includes('English interview question')");
  const enPrep = await evaluate("document.getElementById('int-results').innerText");
  console.log('Interview output (EN, full):', JSON.stringify(enPrep));
  assert(enPrep.includes('English STAR title') && !enPrep.includes('中文STAR标题'), 'English UI output remains English');
  const enMockRequest = await (await fetch('http://localhost:4103/last')).json();
  const enPrompt = [enMockRequest.system, ...((enMockRequest.messages || []).map(m => m.content))].join('\n');
  assert(/Write ALL user-facing text in English\./.test(enPrompt), 'English prompt requested English');
  assert(!/Write ALL user-facing text in (Simplified Chinese|Thai)\./.test(enPrompt), 'English prompt did not request another language');

  console.log('\nPage errors:', JSON.stringify(errors));
  assert(errors.length === 0, 'No browser errors');
} finally {
  console.log('\n--- Restoring original LLM config ---');
  const restored = await api('/api/llm-config', 'POST', {
    models: original.models, activeModelId: original.activeModelId,
  });
  console.log('Restored:', restored.models.length, 'models, active:', restored.activeModelId);
  ws.close();
}
