

  const API = location.port === '3001' ? '' : 'http://127.0.0.1:3001';
  const rows = document.getElementById('rows');
  const stats = document.getElementById('stats');
  const search = document.getElementById('search');
  const modal = document.getElementById('modal');
  const editForm = document.getElementById('editForm');
  const msg = document.getElementById('editStatusMsg');
  let users = [];
  let editingId = null;

  async function load() {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      users = data.users || [];
      render();
    } catch (e) {
      rows.innerHTML = '<tr><td colspan="5" class="empty">Cannot reach the local server. Start app_server.py first.</td></tr>';
      stats.textContent = 'Offline';
    }
  }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function render() {
    const q = search.value.trim().toLowerCase();
    const list = users.filter(u => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    stats.textContent = users.length + ' total · ' + users.filter(u => u.status === 'Active').length + ' active';
    if (!list.length) { rows.innerHTML = '<tr><td colspan="5" class="empty">No users found.</td></tr>'; return; }
    rows.innerHTML = list.map(u => `<tr>
      <td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.registeredAt)}</td>
      <td><span class="badge ${u.status === 'Active' ? 'active' : 'disabled'}">${esc(u.status)}</span></td>
      <td><button class="action-btn" data-edit="${esc(u.id)}">Edit</button><button class="action-btn danger" data-del="${esc(u.id)}">Delete</button></td>
    </tr>`).join('');
  }
  function openEdit(id) {
    const u = users.find(x => x.id === id);
    if (!u) return;
    editingId = id;
    document.getElementById('editName').value = u.name;
    document.getElementById('editEmail').value = u.email;
    document.getElementById('editPassword').value = u.password;
    document.getElementById('editStatus').value = u.status;
    msg.textContent = ''; modal.classList.add('open');
  }
  function closeEdit() { modal.classList.remove('open'); editingId = null; }
  document.getElementById('refresh').addEventListener('click', load);
  document.getElementById('openExcel').addEventListener('click', () => { window.location.href = '/api/admin/users.xlsx'; });
  search.addEventListener('input', render);
  document.getElementById('cancelEdit').addEventListener('click', closeEdit);
  modal.addEventListener('click', e => { if (e.target === modal) closeEdit(); });
  rows.addEventListener('click', async e => {
    const editId = e.target.getAttribute('data-edit');
    const delId = e.target.getAttribute('data-del');
    if (editId) return openEdit(editId);
    if (delId) {
      if (!confirm('Delete this registered user? This cannot be undone.')) return;
      const res = await fetch(API + '/api/users/' + delId, {method:'DELETE'});
      if ((await res.json()).ok) { await load(); } else { alert('Could not delete user.'); }
    }
  });
  editForm.addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('editName').value.trim(),
      email: document.getElementById('editEmail').value.trim(),
      password: document.getElementById('editPassword').value,
      status: document.getElementById('editStatus').value
    };
    const res = await fetch(API + '/api/users/' + editingId, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
    const data = await res.json();
    if (data.ok) { closeEdit(); await load(); }
    else { msg.textContent = data.error || 'Could not save.'; msg.className = 'status error'; }
  });
  load();

