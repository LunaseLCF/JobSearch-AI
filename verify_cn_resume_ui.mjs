import { setTimeout as delay } from 'timers/promises';
import fs from 'fs';

const targets = await (await fetch('http://localhost:9231/json/list')).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = event => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
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
const waitFor = async (expression, timeout = 25000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return true;
    await delay(250);
  }
  return false;
};
function assert(ok, label) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) process.exitCode = 1; }

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Network.clearBrowserCookies');

await send('Page.navigate', { url: 'http://localhost:3100/login' });
await waitFor("!!document.getElementById('loginForm')");
await evaluate(`(() => {
  document.getElementById('email').value = 'laichienfang@gmail.com';
  document.getElementById('password').value = 'cf123456';
  document.getElementById('loginForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
})()`);
await waitFor("location.pathname === '/' && document.getElementById('page-content').innerText.includes('Dashboard')");

await evaluate("document.querySelector('[data-page=\"profile\"]').click()");
await waitFor("!!document.getElementById('resume-paste')");
const text = JSON.parse(fs.readFileSync('data/tmp/_cn_cases.json', 'utf8')).A;
await evaluate(`(() => {
  document.querySelector('details').open = true;
  document.getElementById('resume-paste').value = ${JSON.stringify(text)};
  analyzePastedResume();
  return true;
})()`);
if (!await waitFor("document.getElementById('resume-review').innerText.includes('Resume read successfully')")) {
  throw new Error('Review did not render: ' + await evaluate("document.getElementById('resume-review').innerText"));
}
const review = await evaluate("document.getElementById('resume-review').innerText");
console.log('Review:', JSON.stringify(review.slice(0, 400)));
assert(review.includes('Detected language: Chinese'), 'Review shows detected Chinese language');
assert(review.includes('李明') && review.includes('上海'), 'Review shows Chinese name and location');
assert(review.includes('Experience: 1') && review.includes('Education: 1'), 'Review shows parsed experience and education');
console.log('Errors:', errors.length ? errors.join('\n') : 'none');
assert(errors.length === 0, 'No browser errors');
ws.close();
