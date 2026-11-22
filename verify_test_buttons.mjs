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
    requests.push(msg.params.request.postData || '{}');
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
function assert(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) process.exitCode = 1;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: 'http://localhost:3100/?verify=' + Date.now() });
await waitFor("!!document.querySelector('[data-page=\"llm-config\"]')");
await evaluate("document.querySelector('[data-page=\"llm-config\"]').click()");
await waitFor("document.getElementById('page-content').innerText.includes('Saved Models')");
await waitFor("document.querySelectorAll('.llm-model-card').length > 0");
await delay(2000); // let the page-load health check finish

console.log('--- 1. Saved Models Test button ---');
requests.length = 0;
await evaluate(`[...document.querySelectorAll('.llm-model-card')][0].querySelector('button[onclick^="testLLMModel"]').click()`);
await delay(3500);

const cardResult = await evaluate(`(() => {
  const card = [...document.querySelectorAll('.llm-model-card')][0];
  const inline = card.querySelector('.llm-model-test-result');
  const button = card.querySelector('button[onclick^="testLLMModel"]');
  return {
    inline: inline.innerText,
    inlineHeight: inline.getBoundingClientRect().height,
    buttonTop: button.getBoundingClientRect().top,
    inlineTop: inline.getBoundingClientRect().top,
    otherCardResult: [...document.querySelectorAll('.llm-model-card')][1].querySelector('.llm-model-test-result').innerText,
    status: document.getElementById('llm-status').innerText,
    cardStatus: card.querySelector('.llm-model-status').innerText,
  };
})()`);
console.log('Requests:', JSON.stringify(requests));
console.log('Result:', JSON.stringify(cardResult, null, 2));
assert(requests.length === 1 && requests[0].includes('"modelId":"default"'), 'Only the selected model was tested (no all-model race)');
assert(cardResult.inline.includes('BigModel') && !cardResult.inline.includes('Agnes Model'), 'Inline result shows only the clicked model');
assert(cardResult.inlineHeight > 0 && cardResult.inlineTop - cardResult.buttonTop < 120, 'Result appears directly under the clicked button');
assert(cardResult.status.includes('Connection test failed'), 'Status message reports the test outcome');
assert(cardResult.cardStatus.includes('Failed'), 'Model card status badge refreshed');

console.log('\n--- 2. Add/Edit Model: Test Current Model (mock success) ---');
requests.length = 0;
await evaluate(`(() => {
  const set = (id, value) => { document.getElementById(id).value = value; };
  set('llm-label', 'Verification mock model');
  set('llm-provider', 'OpenAI');
  set('llm-api-key', 'test-key');
  set('llm-model', 'mock-model');
  set('llm-base-url', 'http://127.0.0.1:4102/v1');
  return true;
})()`);
await evaluate(`[...document.querySelectorAll('#page-content button')].find(b => b.getAttribute('onclick') === 'testCurrentLLMModel()').click()`);
await delay(3000);

const currentResult = await evaluate(`({
  status: document.getElementById('llm-status').innerText,
  results: document.getElementById('llm-test-results').innerText,
  panelTop: document.getElementById('llm-test-results').getBoundingClientRect().top
})`);
console.log('Requests:', JSON.stringify(requests));
console.log('Result:', JSON.stringify(currentResult, null, 2));
assert(requests.length === 1 && requests[0].includes('Verification mock model') && !requests[0].includes('modelId'), 'Tests only the form model, with its label, unsaved');
assert(currentResult.results.includes('Verification mock model') && currentResult.results.includes('Connected'), 'Current-model result panel shows success');
assert(!currentResult.results.includes('BigModel') && !currentResult.results.includes('Agnes Model'), 'Saved models were not included in the result');
assert(currentResult.status.includes('Connection test successful'), 'Status message reports success');

console.log('\n--- 3. Language switch keeps new labels ---');
await evaluate("document.getElementById('language-select').value = 'cn'; setLanguage('cn')");
await delay(1200);
const cn = await evaluate(`({
  currentModelButton: [...document.querySelectorAll('#page-content button')].some(b => b.innerText.includes('测试当前模型')),
  allModelsButton: [...document.querySelectorAll('#page-content button')].some(b => b.innerText.includes('测试所有模型')),
})`);
console.log('CN:', JSON.stringify(cn));
assert(cn.currentModelButton && cn.allModelsButton, 'Both test buttons translated in Chinese');

console.log('\nPage errors:', JSON.stringify(errors));
assert(errors.length === 0, 'No browser errors');
ws.close();
