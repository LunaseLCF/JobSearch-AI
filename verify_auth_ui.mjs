import { setTimeout as delay } from 'timers/promises';

const targets = await (await fetch('http://localhost:9227/json/list')).json();
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
function assert(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) process.exitCode = 1;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: 'http://localhost:3100/?authcheck=' + Date.now() });
await evaluate("window.alert = msg => { window.__lastAlert = msg; }; true");

console.log('--- 1. Login gate ---');
if (!await waitFor("document.getElementById('auth-overlay') && getComputedStyle(document.getElementById('auth-overlay')).display === 'flex'")) {
  throw new Error('Login overlay did not appear');
}
assert(await evaluate("getComputedStyle(document.getElementById('app')).display === 'none'"), 'App is hidden before login');

await evaluate(`(() => {
  document.getElementById('auth-email').value = 'admin@local.app';
  document.getElementById('auth-password').value = 'admin1234';
  document.getElementById('auth-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
})()`);
if (!await waitFor("getComputedStyle(document.getElementById('auth-overlay')).display === 'none'")) {
  throw new Error('Login did not hide overlay: ' + await evaluate("document.getElementById('auth-error').innerText"));
}
await waitFor("document.getElementById('page-content').innerText.includes('Dashboard')");
const ownerState = await evaluate(`({
  email: document.getElementById('account-email').innerText,
  plan: document.getElementById('account-plan').innerText,
  appVisible: getComputedStyle(document.getElementById('app')).display !== 'none',
  content: document.getElementById('page-content').innerText.slice(0, 200)
})`);
console.log('Owner state:', JSON.stringify(ownerState));
assert(ownerState.email === 'admin@local.app' && ownerState.plan === 'Owner', 'Account panel shows owner identity and plan');
assert(ownerState.appVisible, 'App becomes visible after login');

console.log('\n--- 2. Owner can open gated pages and session survives reload ---');
await evaluate("document.querySelector('[data-page=\"interview\"]').click()");
await waitFor("document.getElementById('page-content').innerText.includes('Interview Preparation')");
assert(true, 'Owner can open Interview Prep');
await send('Page.navigate', { url: 'http://localhost:3100/?authcheck2=' + Date.now() });
await waitFor("getComputedStyle(document.getElementById('auth-overlay')).display === 'none' && document.getElementById('page-content').innerText.includes('Dashboard')");
await evaluate("window.alert = msg => { window.__lastAlert = msg; }; true");
assert(true, 'Session persists after page reload');

console.log('\n--- 3. Free user is restricted ---');
await evaluate("logoutUser()");
await waitFor("getComputedStyle(document.getElementById('auth-overlay')).display === 'flex'");
await evaluate("toggleAuthMode()");
await waitFor("getComputedStyle(document.getElementById('auth-name-group')).display !== 'none'");
const freeEmail = `free_ui_${Date.now()}@example.com`;
await evaluate(`(() => {
  document.getElementById('auth-name').value = 'UI Free User';
  document.getElementById('auth-email').value = '${freeEmail}';
  document.getElementById('auth-password').value = 'password123';
  document.getElementById('auth-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
})()`);
await waitFor("getComputedStyle(document.getElementById('auth-overlay')).display === 'none'");
await delay(500);
const freeState = await evaluate(`({
  plan: document.getElementById('account-plan').innerText,
  locked: ['apply','interview','llm-config','repo','report'].map(p => document.querySelector('[data-page="'+p+'"]').classList.contains('nav-locked')),
  dashboard: document.getElementById('page-content').innerText.includes('Dashboard')
})`);
console.log('Free state:', JSON.stringify(freeState));
assert(freeState.plan === 'Free', 'New account receives Free plan');
assert(freeState.locked.every(Boolean), 'Paid nav items are locked for Free plan');
await evaluate("document.querySelector('[data-page=\"interview\"]').click()");
await delay(500);
const blocked = await evaluate(`({
  active: document.querySelector('[data-page="interview"]').classList.contains('active'),
  notice: String(window.__lastAlert || '').includes('Pro plan')
})`);
console.log('Blocked navigation:', JSON.stringify(blocked));
assert(!blocked.active && blocked.notice, 'Clicking a locked page shows upgrade notice without navigating');

console.log('\nPage errors:', JSON.stringify(errors));
assert(errors.length === 0, 'No browser errors');
ws.close();
