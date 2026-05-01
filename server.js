require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'zmien_to_natychmiast';
const db = new Database(path.join(__dirname, 'energomat.db'));

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  tariff TEXT,
  usage_mwh REAL,
  current_price REAL,
  status TEXT NOT NULL DEFAULT 'nowy lead',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  lead_id INTEGER,
  author TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(lead_id) REFERENCES leads(id)
);
`);

function createAdminIfMissing() {
  const email = process.env.ADMIN_EMAIL || 'admin@energomat.org';
  const password = process.env.ADMIN_PASSWORD || 'ZmienHaslo123!';
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!exists) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (name, company, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run('Administrator', 'Energomat', email, hash, 'admin');
    console.log(`Utworzono konto admina: ${email}`);
  }
}
createAdminIfMissing();

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Brak tokenu logowania.' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sesja wygasła. Zaloguj się ponownie.' });
  }
}

function requireAgent(req, res, next) {
  if (!['agent', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Brak dostępu do CRM.' });
  }
  next();
}

app.post('/api/auth/register', (req, res) => {
  const { name, company, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Podaj imię, email i hasło.' });
  if (password.length < 6) return res.status(400).json({ error: 'Hasło musi mieć minimum 6 znaków.' });

  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare('INSERT INTO users (name, company, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(name, company || '', email.toLowerCase(), hash, 'client');
    const user = db.prepare('SELECT id, name, company, email, role FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.json({ token: signToken(user), user });
  } catch (e) {
    res.status(400).json({ error: 'Taki email już istnieje.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Nieprawidłowy email lub hasło.' });
  }
  res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, company: user.company, email: user.email, role: user.role }
  });
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, company, email, role, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

app.post('/api/leads', (req, res) => {
  const { name, company, phone, email, tariff, usage_mwh, current_price, note } = req.body;
  if (!name || !company || !phone || !email) {
    return res.status(400).json({ error: 'Uzupełnij imię, firmę, telefon i email.' });
  }

  let userId = null;
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try { userId = jwt.verify(header.slice(7), JWT_SECRET).id; } catch {}
  }

  const info = db.prepare(`
    INSERT INTO leads (user_id, name, company, phone, email, tariff, usage_mwh, current_price, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, name, company, phone, email, tariff || '', Number(usage_mwh) || 0, Number(current_price) || 0, note || '');

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);
  res.json({ lead });
});

app.get('/api/my/leads', auth, (req, res) => {
  const leads = db.prepare('SELECT * FROM leads WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json({ leads });
});

app.get('/api/crm/leads', auth, requireAgent, (req, res) => {
  const leads = db.prepare('SELECT * FROM leads ORDER BY id DESC').all();
  res.json({ leads });
});

app.patch('/api/crm/leads/:id', auth, requireAgent, (req, res) => {
  const { status, note } = req.body;
  db.prepare('UPDATE leads SET status = COALESCE(?, status), note = COALESCE(?, note) WHERE id = ?')
    .run(status || null, note || null, req.params.id);
  res.json({ lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id) });
});

app.post('/api/chat', async (req, res) => {
  const { message, lead_id } = req.body;
  if (!message) return res.status(400).json({ error: 'Wpisz wiadomość.' });

  let userId = null;
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    try { userId = jwt.verify(header.slice(7), JWT_SECRET).id; } catch {}
  }

  db.prepare('INSERT INTO chat_messages (user_id, lead_id, author, message) VALUES (?, ?, ?, ?)')
    .run(userId, lead_id || null, 'client', message);

  const lower = message.toLowerCase();
  let reply = 'Dziękuję za wiadomość. Doradca Energomat może pomóc porównać energię, gaz, taryfę i obecne koszty firmy.';
  if (lower.includes('gaz')) reply = 'W sprawie gazu sprawdzimy zużycie, cenę za MWh, okres umowy i możliwość negocjacji warunków.';
  if (lower.includes('oszcz')) reply = 'Aby policzyć oszczędność, potrzebujemy rocznego zużycia MWh, taryfy, operatora i obecnej ceny z faktury.';
  if (lower.includes('agent') || lower.includes('doradc')) reply = 'Przekazuję rozmowę do doradcy. Uzupełnij formularz kontaktowy, aby lead trafił do CRM.';

  db.prepare('INSERT INTO chat_messages (user_id, lead_id, author, message) VALUES (?, ?, ?, ?)')
    .run(userId, lead_id || null, 'assistant', reply);

  res.json({ reply });
});

app.get('/api/crm/chat', auth, requireAgent, (req, res) => {
  const messages = db.prepare('SELECT * FROM chat_messages ORDER BY id DESC LIMIT 100').all();
  res.json({ messages });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Energomat MVP działa na porcie ${PORT}`);
});
