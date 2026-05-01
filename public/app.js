const API = '';
const token = () => localStorage.getItem('energomat_token');
const setToken = (t) => localStorage.setItem('energomat_token', t);
const logout = () => { localStorage.removeItem('energomat_token'); location.href='/login.html'; };
const headers = () => token() ? { 'Content-Type':'application/json', 'Authorization':'Bearer '+token() } : { 'Content-Type':'application/json' };

async function api(path, options={}) {
  const res = await fetch(API + path, { ...options, headers: { ...headers(), ...(options.headers||{}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Błąd serwera');
  return data;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function leadHtml(lead, crm=false) {
  return `<div class="lead">
    <strong>${lead.company} - ${lead.name}</strong>
    <div class="muted">${lead.email} · ${lead.phone}</div>
    <div>Taryfa: ${lead.tariff || '-'} · Zużycie: ${lead.usage_mwh || 0} MWh · Cena: ${lead.current_price || 0} zł/MWh</div>
    <div>Status: <b>${lead.status}</b></div>
    ${crm ? `<select class="status" data-id="${lead.id}">
      ${['nowy lead','kontakt','oferta','umowa','klient'].map(s=>`<option ${lead.status===s?'selected':''}>${s}</option>`).join('')}
    </select>` : ''}
  </div>`;
}

document.querySelector('#logout')?.addEventListener('click', logout);

document.querySelector('#registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.querySelector('#status');
  try {
    const data = await api('/api/auth/register', { method:'POST', body: JSON.stringify(formData(e.target)) });
    setToken(data.token);
    location.href = '/panel.html';
  } catch (err) { status.textContent = err.message; }
});

document.querySelector('#loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.querySelector('#status');
  try {
    const data = await api('/api/auth/login', { method:'POST', body: JSON.stringify(formData(e.target)) });
    setToken(data.token);
    location.href = data.user.role === 'admin' || data.user.role === 'agent' ? '/crm.html' : '/panel.html';
  } catch (err) { status.textContent = err.message; }
});

document.querySelector('#leadForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.querySelector('#leadStatus');
  try {
    const data = await api('/api/leads', { method:'POST', body: JSON.stringify(formData(e.target)) });
    status.textContent = `Lead zapisany w CRM. Numer: ${data.lead.id}`;
    e.target.reset();
  } catch (err) { status.textContent = err.message; }
});

async function loadPanel() {
  if (!document.querySelector('#me')) return;
  try {
    const me = await api('/api/me');
    document.querySelector('#me').textContent = `${me.user.name} · ${me.user.email} · rola: ${me.user.role}`;
    const data = await api('/api/my/leads');
    document.querySelector('#myLeads').innerHTML = data.leads.length ? data.leads.map(l => leadHtml(l)).join('') : '<p>Brak zapytań.</p>';
  } catch { location.href='/login.html'; }
}

async function loadCrm() {
  if (!document.querySelector('#crmLeads')) return;
  try {
    const data = await api('/api/crm/leads');
    document.querySelector('#crmLeads').innerHTML = data.leads.length ? data.leads.map(l => leadHtml(l, true)).join('') : '<p>Brak leadów.</p>';
    document.querySelectorAll('.status').forEach(sel => {
      sel.addEventListener('change', async () => {
        await api('/api/crm/leads/'+sel.dataset.id, { method:'PATCH', body: JSON.stringify({ status: sel.value }) });
        loadCrm();
      });
    });
    const chat = await api('/api/crm/chat');
    document.querySelector('#crmChat').innerHTML = chat.messages.map(m => `<div class="lead"><b>${m.author}</b>: ${m.message}<div class="muted">${m.created_at}</div></div>`).join('');
  } catch (e) {
    document.querySelector('#crmLeads').innerHTML = `<p>${e.message}. Zaloguj się jako admin/agent.</p>`;
  }
}

const chatBubble = document.querySelector('#chatBubble');
const chatBox = document.querySelector('#chatBox');
const chatSend = document.querySelector('#chatSend');
chatBubble?.addEventListener('click', () => chatBox.classList.toggle('open'));

function addMsg(text, author='client') {
  const box = document.querySelector('#chatMessages');
  const div = document.createElement('div');
  div.className = 'msg ' + author;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

chatSend?.addEventListener('click', async () => {
  const input = document.querySelector('#chatInput');
  const message = input.value.trim();
  if (!message) return;
  addMsg(message, 'client');
  input.value = '';
  try {
    const data = await api('/api/chat', { method:'POST', body: JSON.stringify({ message }) });
    addMsg(data.reply, 'assistant');
  } catch (e) { addMsg(e.message, 'assistant'); }
});

loadPanel();
loadCrm();
