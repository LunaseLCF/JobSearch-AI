import { setTimeout as delay } from 'timers/promises';

const targets = await (await fetch('http://localhost:9229/json/list')).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let seq = 0;
const pending = new Map();
const errors = [];
const notFound = [];
ws.onmessage = event => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Network.responseReceived' && msg.params.response?.status === 404) {
    notFound.push(msg.params.response.url);
  }
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
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Network.clearBrowserCookies');

console.log('--- 1. Unauthenticated root redirects to /login ---');
await navigate('http://localhost:3100/?linked=' + Date.now());
if (!await waitFor("location.pathname === '/login' && !!document.getElementById('loginForm')")) {
  throw new Error('Root did not redirect to the login page. URL=' + await evaluate('location.href'));
}
assert(await evaluate("document.getElementById('formTitle').innerText === 'Welcome back'"), 'Dedicated login page rendered');

console.log('\n--- 2. Excel user signs in and lands in the app ---');
await evaluate(`(() => {
  document.getElementById('email').value = 'laichienfang@gmail.com';
  document.getElementById('password').value = 'cf123456';
  document.getElementById('loginForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
})()`);
if (!await waitFor("location.pathname === '/' && !!document.getElementById('page-content') && document.getElementById('page-content').innerText.includes('Dashboard')")) {
  throw new Error('Login did not land on dashboard. URL=' + await evaluate('location.href') + ' status=' + await evaluate("document.getElementById('status')?.innerText"));
}
const account = await evaluate(`({
  email: document.getElementById('account-email')?.innerText,
  plan: document.getElementById('account-plan')?.innerText
})`);
console.log('Account:', JSON.stringify(account));
assert(account.email === 'laichienfang@gmail.com' && account.plan === 'Owner', 'Excel user logged in with Owner level');

console.log('\n--- 3. Visiting /login while signed in returns to app ---');
await navigate('http://localhost:3100/login');
if (!await waitFor("location.pathname === '/' && document.getElementById('page-content').innerText.includes('Dashboard')")) {
  throw new Error('Signed-in /login did not redirect. URL=' + await evaluate('location.href'));
}
assert(true, 'Login page auto-redirects authenticated users');

console.log('\n--- 4. Logout returns to /login, then registration creates a Free user ---');
await evaluate('logoutUser()');
if (!await waitFor("location.pathname === '/login' && !!document.getElementById('loginForm')")) {
  throw new Error('Logout did not go to /login. URL=' + await evaluate('location.href'));
}
assert(true, 'Logout lands on the login page');

await navigate('http://localhost:3100/register');
if (!await waitFor("location.pathname === '/register' && !!document.getElementById('registerForm')")) {
  throw new Error('Register page missing. URL=' + await evaluate('location.href'));
}
const email = 'linked_' + Date.now() + '@example.com';
await evaluate(`(() => {
  document.getElementById('fullName').value = 'Linked User';
  document.getElementById('email').value = ${JSON.stringify(email)};
  document.getElementById('password').value = 'password123';
  document.getElementById('confirmPassword').value = 'password123';
  document.getElementById('registerForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
})()`);
if (!await waitFor("location.pathname === '/' && document.getElementById('page-content').innerText.includes('Dashboard')")) {
  throw new Error('Registration did not land on dashboard. URL=' + await evaluate('location.href') + ' status=' + await evaluate("document.getElementById('status')?.innerText"));
}
const newPlan = await evaluate("document.getElementById('account-plan').innerText");
assert(newPlan === 'Free', 'New registration gets Free level');

console.log('\n--- 5. Free user is blocked from Pro API ---');
const blocked = await evaluate(`(async () => {
  const res = await fetch('/api/interview-prep', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({company:'X',role:'Y'}) });
  return { status: res.status, body: await res.json() };
})()`);
console.log('Blocked response:', JSON.stringify(blocked));
assert(blocked.status === 403, 'Free user blocked from AI interview API');

console.log('\n--- 6. Owner admin page manages levels ---');
await navigate('http://localhost:3100/login');
await waitFor("location.pathname === '/login' && !!document.getElementById('loginForm')");
await evaluate(`(() => {
  document.getElementById('email').value = 'laichienfang@gmail.com';
  document.getElementById('password').value = 'cf123456';
  document.getElementById('loginForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
})()`);
await waitFor("location.pathname === '/'");
await navigate('http://localhost:3100/admin');
if (!await waitFor("location.pathname === '/admin' && document.getElementById('rows').innerText.includes('laichienfang@gmail.com')")) {
  throw new Error('Admin page did not list users: ' + await evaluate("document.getElementById('rows').innerText.slice(0,300)"));
}
assert(await evaluate("document.getElementById('rows').innerText.includes('OWNER')"), 'Admin table shows user level');
const adminResult = await evaluate(`(async () => {
  const email = 'admin_test_' + Date.now() + '@example.com';
  const create = await fetch('/api/admin/users', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name:'Admin Test',email,password:'password123',level:'pro'}) });
  const created = await create.json();
  if (!created.ok) return { createStatus: create.status, created };
  const update = await fetch('/api/admin/users/' + created.user.id, { method:'PUT', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({level:'team'}) });
  const updated = await update.json();
  const del = await fetch('/api/admin/users/' + created.user.id, { method:'DELETE', credentials:'same-origin' });
  return { createStatus: create.status, levelAfterUpdate: updated.user?.level, deleteOk: (await del.json()).ok };
})()`);
console.log('Admin API result:', JSON.stringify(adminResult));
assert(adminResult.createStatus === 200 && adminResult.levelAfterUpdate === 'team' && adminResult.deleteOk, 'Owner can create, change level, and delete users');

console.log('\n--- Browser errors (expected 403 from the Free-user check is excluded) ---');
console.log('404 URLs:', JSON.stringify([...new Set(notFound)]));
const unexpected = errors.filter(e => !e.includes('403 (Forbidden)') && !e.includes('404 (Not Found)'));
console.log(unexpected.length ? unexpected.slice(0, 5).join('\n') : 'none');
assert(unexpected.length === 0 && notFound.length === 0, 'No unexpected browser console errors');
ws.close();
