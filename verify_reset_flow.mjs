import { setTimeout as delay } from 'timers/promises';

const targets = await (await fetch('http://localhost:9230/json/list')).json();
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
function assert(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) process.exitCode = 1;
}
const navigate = url => send('Page.navigate', { url });

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Network.clearBrowserCookies');

console.log('--- 1. Forgot mode: unregistered email warning ---');
await navigate('http://localhost:3100/login');
await waitFor("!!document.getElementById('loginForm')");
await evaluate("document.getElementById('forgotLink').click()");
await evaluate(`(() => {
  document.getElementById('email').value = 'no_such_' + Date.now() + '@example.com';
  document.getElementById('loginForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
})()`);
if (!await waitFor("document.getElementById('status').innerText.includes('No account was found')")) {
  throw new Error('Unregistered warning missing: ' + await evaluate("document.getElementById('status').innerText"));
}
assert(true, 'Unregistered email shows a clear warning');

console.log('\n--- 2. Forgot mode: registered email success + dev link ---');
const email = await evaluate(`(async () => {
  const mail = 'reset_ui_' + Date.now() + '@example.com';
  await fetch('/api/auth/register', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email:mail,name:'Reset UI User',password:'originalpass123'}) });
  await fetch('/api/auth/logout', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:'{}' });
  return mail;
})()`);
await evaluate(`(() => {
  document.getElementById('email').value = ${JSON.stringify(email)};
  document.getElementById('loginForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
})()`);
if (!await waitFor("document.getElementById('status').innerText.includes('reset link has been sent')")) {
  throw new Error('Success message missing: ' + await evaluate("document.getElementById('status').innerText"));
}
assert(await evaluate("!!document.querySelector('#status a')"), 'Success message includes the development reset link');

console.log('\n--- 3. Reset page validates token and accepts a new password ---');
const resetUrl = await evaluate("document.querySelector('#status a').href");
await navigate(resetUrl);
if (!await waitFor("location.pathname === '/reset-password' && document.getElementById('resetForm').style.display === 'block'")) {
  throw new Error('Reset form did not appear: ' + await evaluate("document.body.innerText.slice(0,400)"));
}
assert(await evaluate(`document.getElementById('accountBox').innerText.includes(${JSON.stringify(email)})`), 'Reset page shows the matched account');
await evaluate(`(() => {
  document.getElementById('password').value = 'changedpass456';
  document.getElementById('confirmPassword').value = 'differentpass789';
  document.getElementById('resetForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
})()`);
if (!await waitFor("document.getElementById('status').innerText.includes('do not match')")) {
  throw new Error('Mismatch warning missing');
}
assert(true, 'Mismatched passwords are rejected');

await evaluate(`(() => {
  document.getElementById('confirmPassword').value = 'changedpass456';
  document.getElementById('resetForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
})()`);
if (!await waitFor("location.pathname === '/login' && document.getElementById('status')?.innerText.includes('password has been reset')")) {
  throw new Error('No confirmation on login page: ' + await evaluate('location.href'));
}
assert(true, 'Login page confirms the reset');

console.log('\n--- 4. Login with the new password ---');
await evaluate("setMode('login')");
await evaluate(`(() => {
  document.getElementById('email').value = ${JSON.stringify(email)};
  document.getElementById('password').value = 'changedpass456';
  document.getElementById('loginForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
})()`);
if (!await waitFor("location.pathname === '/' && document.getElementById('page-content').innerText.includes('Dashboard')")) {
  throw new Error('Login with new password failed: ' + await evaluate('location.href') + ' ' + await evaluate("document.getElementById('status')?.innerText"));
}
assert(true, 'New password works for sign in');

console.log('\n--- Browser errors ---');
console.log(errors.length ? errors.slice(0, 5).join('\n') : 'none');
assert(errors.length === 0, 'No browser console errors');
ws.close();
