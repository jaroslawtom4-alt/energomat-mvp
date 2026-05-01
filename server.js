require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { Resend } = require('resend'); // ✅ ZAMIANA

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'zmien_to_natychmiast';
const db = new Database(path.join(__dirname, 'energomat.db'));

// 🔐 RESEND
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 🗄️ DB
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

// 📧 NOWA FUNKCJA MAILA (RESEND)
async function sendLeadEmail(lead) {
  if (!process.env.RESEND_API_KEY) {
    console.log('Brak RESEND_API_KEY - mail nie wysłany');
    return;
  }

  try {
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: process.env.LEAD_EMAIL_TO || 'twoj@email.pl',
      subject: `Nowy lead Energomat - ${lead.company}`,
      html: `
        <h2>Nowy lead Energomat</h2>
        <p><b>Imię:</b> ${lead.name}</p>
        <p><b>Firma:</b> ${lead.company}</p>
        <p><b>Telefon:</b> ${lead.phone}</p>
        <p><b>Email:</b> ${lead.email}</p>
        <p><b>Taryfa:</b> ${lead.tariff || '-'}</p>
        <p><b>Zużycie:</b> ${lead.usage_mwh || '-'}</p>
        <p><b>Cena:</b> ${lead.current_price || '-'}</p>
        <p><b>Status:</b> ${lead.status}</p>
        <p><b>Notatka:</b> ${lead.note || '-'}</p>
      `
    });

    console.log('✅ MAIL WYSŁANY');
  } catch (e) {
    console.log('❌ Błąd wysyłki maila:', e.message);
  }
}

// 👤 ADMIN
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

// 🔐 AUTH
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
    res.status(401).json({ error: 'Sesja wygasła.' });
  }
}

function requireAgent(req, res, next) {
  if (!['agent', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Brak dostępu.' });
  }
  next();
}

// 🔐 LOGIN / REGISTER
app.post('/api/auth/register', (req, res) => {
  const { name, company, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Brak danych.' });

  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare('INSERT INTO users (name, company, email, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(name, company || '', email.toLowerCase(), hash, 'client');

    const user = db.prepare('SELECT id, name, company, email, role FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.json({ token: signToken(user), user });
  } catch {
    res.status(400).json({ error: 'Email już istnieje.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Błędne dane.' });
  }

  res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, company: user.company, email: user.email, role: user.role }
  });
});

// 🟢 LEAD
app.post('/api/leads', async (req, res) => {
  const { name, company, phone, email, tariff, usage_mwh, current_price, note } = req.body;

  if (!name || !company || !phone || !email) {
    return res.status(400).json({ error: 'Uzupełnij dane.' });
  }

  const info = db.prepare(`
    INSERT INTO leads (name, company, phone, email, tariff, usage_mwh, current_price, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, company, phone, email, tariff || '', Number(usage_mwh) || 0, Number(current_price) || 0, note || '');

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(info.lastInsertRowid);

  await sendLeadEmail(lead); // 🔥 TU DZIAŁA

  res.json({ lead });
});

// 🌐 FRONT
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🚀 START
app.listen(PORT, () => {
  console.log(`Energomat działa na porcie ${PORT}`);
});
