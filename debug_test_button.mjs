import { setTimeout as delay } from 'timers/promises';

const targets = await (await fetch('http://localhost:9224/json/list')).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let seq = 0;
const pending = new Map();
const errors = [];
const requests = [];
ws.onmessage = event => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
  if (msg.method === 'Network.requestWillBeSent' && msg.params.request.url.includes('/api/llm-test')) {
    requests.push({ url: msg.params.request.url, body: msg.params.request.postData });
  }
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
const waitFor = async (expression, timeout = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return true;
    await delay(200);
  }
  return false;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Page.navigate', { url: 'http://localhost:3100/' });
await waitFor("!!document.querySelector('[data-page=\"llm-config\"]')");
await evaluate("document.querySelector('[data-page=\"llm-config\"]').click()");
await waitFor("document.getElementById('page-content').innerText.includes('Saved Models')");
await delay(800);
console.log('DEBUG content:', JSON.stringify(await evaluate("document.getElementById('page-content').innerText.slice(0, 900)")));
console.log('DEBUG lang:', await evaluate("document.getElementById('language-select')?.value"));
console.log('DEBUG all buttons:', await evaluate("[...document.querySelectorAll('#page-content button')].map(b => b.innerText.trim())"));

console.log('Global functions:', await evaluate(`({
  testLLMModel: typeof testLLMModel,
  renderLLMTestResults: typeof renderLLMTestResults,
  testLLMConnection: typeof testLLMConnection
})`));

console.log('Test buttons:', await evaluate(`[...document.querySelectorAll('#page-content button')]
  .filter(b => b.innerText.trim() === 'Test')
  .map(b => ({ onclick: b.getAttribute('onclick'), visible: b.getBoundingClientRect().width > 0 }))`));

const before = await evaluate(`({ status: document.getElementById('llm-status').innerHTML, results: document.getElementById('llm-test-results').innerHTML })`);
console.log('Before click status:', JSON.stringify(before.status.slice(0, 120)));
console.log('Before click results length:', before.results.length);

// Click the first saved-model Test button the same way a user does.
await evaluate(`[...document.querySelectorAll('#page-content button')].find(b => b.innerText.trim() === 'Test').click()`);
await delay(4000);

const after = await evaluate(`({
  status: document.getElementById('llm-status').innerText,
  results: document.getElementById('llm-test-results').innerText,
  resultsVisible: document.getElementById('llm-test-results').getBoundingClientRect().height > 0,
  badge: document.getElementById('llm-health-badge').innerText,
  scrollY: window.scrollY,
  resultsTop: document.getElementById('llm-test-results').getBoundingClientRect().top
})`);
console.log('Network requests:', JSON.stringify(requests, null, 2));
console.log('After click:', JSON.stringify(after, null, 2));
console.log('Errors:', JSON.stringify(errors, null, 2));

ws.close();
