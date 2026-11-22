from pathlib import Path

p = Path(__file__).resolve().parent.parent / "admin.html"
s = p.read_text(encoding="utf-8")
start = s.index("<script>") + len("<script>")
end = s.index("</script>")

new = r'''
  const API = (location.port === '3100' || location.port === '') ? '' : 'http://127.0.0.1:3100';
  const rows = document.getElementById('rows');
  const stats = document.getElementById('stats');
  const search = document.getElementById('search');
  const modal = document.getElementById('modal');
  const editForm = document.getElementById('editForm');
  const msg = document.getElementById('editStatusMsg');
  let users = [];
  let editingId = null;

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  async function ensureOwner() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const data = await res.json();
      if (!data.user || data.user.plan !== 'owner') { window.location.replace('/login?reason=owner'); return false; }
      return true;
    } catch (e) { window.location.replace('/login'); return false; }
  }

  async function load() {
    try {
      const res = await fetch('/api/admin/users', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('Forbidden');
      const data = await res.json();
      users = data.users || [];
      render();
    } catch (e) {
      rows.innerHTML = '<tr><td colspan="6" class="empty">Cannot load users. Owner access is required.</td></tr>';
      stats.textContent = 'Offline';
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const list = users.filter(u => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
    stats.textContent = users.length + ' total · ' + users.filter(u => u.status === 'Active').length + ' active';
    if (!list.length) { rows.innerHTML = '<tr><td colspan="6" class="empty">No users found.</td></tr>'; return; }
    rows.innerHTML = list.map(u => `<tr>
      <td>${esc(u.name)}</td><td>${esc(u.email)}</td>
      <td><span class="badge active">${esc(String(u.level || 'free').toUpperCase())}</span></td>
      <td>${esc(u.registeredAt)}</td>
      <td><span class="badge ${u.status === 'Active' ? 'active' : 'disabled'}">${esc(u.status)}</span></td>
      <td><button class="action-btn" data-edit="${esc(u.id)}">Edit</button><button class="action-btn danger" data-del="${esc(u.id)}">Delete</button></td>
    </tr>`).join('');
  }

  function openModal(user) {
    editingId = user ? user.id : null;
    document.getElementById('editName').value = user ? user.name : '';
    document.getElementById('editEmail').value = user ? user.email : '';
    document.getElementById('editEmail').disabled = !!user;
    document.getElementById('editLevel').value = user ? user.level : 'free';
    document.getElementById('editPassword').value = '';
    document.getElementById('editStatus').value = user ? user.status : 'Active';
    document.querySelector('.modal-card h3').textContent = user ? 'Edit user' : 'New user';
    msg.textContent = '';
    modal.classList.add('open');
  }
  function closeModal() { modal.classList.remove('open'); editingId = null; }

  document.getElementById('refresh').addEventListener('click', load);
  document.getElementById('newUser').addEventListener('click', () => openModal(null));
  document.getElementById('openExcel').addEventListener('click', () => { window.location.href = API + '/data/Registered_Users.xlsx'; });
  search.addEventListener('input', render);
  document.getElementById('cancelEdit').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

  rows.addEventListener('click', async e => {
    const editId = e.target.getAttribute('data-edit');
    const delId = e.target.getAttribute('data-del');
    if (editId) return openModal(users.find(x => x.id === editId));
    if (delId) {
      if (!confirm('Delete this registered user? This cannot be undone.')) return;
      const res = await fetch(API + '/api/admin/users/' + encodeURIComponent(delId), { method: 'DELETE', credentials: 'same-origin' });
      const data = await res.json();
      if (data.ok) await load(); else alert(data.error || 'Could not delete user.');
    }
  });

  editForm.addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('editName').value.trim(),
      email: document.getElementById('editEmail').value.trim(),
      level: document.getElementById('editLevel').value,
      status: document.getElementById('editStatus').value,
      password: document.getElementById('editPassword').value,
    };
    const url = API + '/api/admin/users' + (editingId ? '/' + encodeURIComponent(editingId) : '');
    const res = await fetch(url, {
      method: editingId ? 'PUT' : 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) { closeModal(); await load(); }
    else { msg.textContent = data.error || 'Could not save.'; msg.className = 'status error'; }
  });

  (async () => { if (await ensureOwner()) load(); })();
'''

p.write_text(s[:start] + new + s[end:], encoding="utf-8")
print("admin.html script replaced")
