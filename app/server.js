'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const QRCode = require('qrcode');
const config = require('./config');

const PORT = Number(process.env.PORT) || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'attendance.db');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  if (process.env.NODE_ENV === 'production') {
    console.error('ADMIN_PASSWORD must be set in production.');
    process.exit(1);
  }
  ADMIN_PASSWORD = 'admin';
  console.warn('ADMIN_PASSWORD not set — using "admin" for local development.');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('jpps:' + ADMIN_PASSWORD).digest('hex');
const SESSION_HOURS = 12;

// ── Database ────────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    dates TEXT NOT NULL DEFAULT '',
    venue TEXT NOT NULL DEFAULT '',
    pin TEXT NOT NULL DEFAULT '',
    require_pin INTEGER NOT NULL DEFAULT 1,
    ask_dept INTEGER NOT NULL DEFAULT 1,
    closed INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    grade TEXT NOT NULL,
    dept TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('present','absent')),
    reason TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS records_program ON records(program_id, date);
`);
if (!db.prepare('SELECT COUNT(*) AS n FROM programs').get().n) {
  const s = config.seedProgram;
  db.prepare('INSERT INTO programs (name, dates, venue, pin, active) VALUES (?, ?, ?, ?, 1)').run(s.name, s.dates, s.venue, s.pin);
}

const q = {
  active: db.prepare('SELECT * FROM programs WHERE active = 1 ORDER BY id DESC LIMIT 1'),
  latest: db.prepare('SELECT * FROM programs ORDER BY id DESC LIMIT 1'),
  byId: db.prepare('SELECT * FROM programs WHERE id = ?'),
  list: db.prepare(`SELECT p.*,
      COALESCE(SUM(r.status = 'present'), 0) AS present,
      COALESCE(SUM(r.status = 'absent'), 0) AS absent
    FROM programs p LEFT JOIN records r ON r.program_id = p.id
    GROUP BY p.id ORDER BY p.id DESC`),
  insertProgram: db.prepare('INSERT INTO programs (name, dates, venue, pin) VALUES (?, ?, ?, ?)'),
  clearActive: db.prepare('UPDATE programs SET active = 0'),
  setActive: db.prepare('UPDATE programs SET active = 1 WHERE id = ?'),
  deleteProgram: db.prepare('DELETE FROM programs WHERE id = ?'),
  records: db.prepare('SELECT * FROM records WHERE program_id = ? ORDER BY id'),
  dup: db.prepare('SELECT 1 FROM records WHERE program_id = ? AND date = ? AND lower(name) = lower(?) LIMIT 1'),
  insertRecord: db.prepare('INSERT INTO records (program_id, name, grade, dept, status, reason, date, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  deleteRecord: db.prepare('DELETE FROM records WHERE id = ?'),
};

const publicProgram = p => p && ({
  id: p.id, name: p.name, dates: p.dates, venue: p.venue,
  requirePin: !!p.require_pin, askDept: !!p.ask_dept, closed: !!p.closed, active: !!p.active,
});
const adminProgram = p => p && ({ ...publicProgram(p), pin: p.pin, present: p.present ?? undefined, absent: p.absent ?? undefined, createdAt: p.created_at });
const recordOut = r => ({ id: r.id, name: r.name, grade: r.grade, dept: r.dept, status: r.status, reason: r.reason, date: r.date, time: r.time });

// Local date and time in the organisation's time zone.
function nowLocal() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// ── Sessions (signed cookie) ────────────────────────────────────────────────
const sign = v => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url');
function makeToken() { const exp = String(Date.now() + SESSION_HOURS * 3600e3); return `${exp}.${sign(exp)}`; }
function validToken(t) {
  if (!t || typeof t !== 'string') return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig) return false;
  const good = sign(exp);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  return Number(exp) > Date.now();
}
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
const isAdmin = req => validToken(readCookie(req, 'jpps_admin'));
function requireAdmin(req, res, next) { if (isAdmin(req)) return next(); res.status(401).json({ error: 'Admin login required.' }); }

// Simple fixed-window rate limiter.
function limiter(max, windowMs) {
  const hits = new Map();
  return key => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now > h.reset) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    h.n += 1;
    return h.n <= max;
  };
}
const loginLimit = limiter(10, 15 * 60e3);
const pinLimit = limiter(20, 10 * 60e3);

// ── App ─────────────────────────────────────────────────────────────────────
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const str = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const findProgram = id => (id ? q.byId.get(Number(id)) : (q.active.get() || q.latest.get()));

app.get('/api/config', (req, res) => {
  res.json({ orgName: config.orgName, orgNameLines: config.orgNameLines, grades: config.grades, departments: config.departments, timeZone: config.timeZone });
});

app.get('/api/program', (req, res) => {
  const p = findProgram(req.query.p);
  if (!p) return res.status(404).json({ error: 'Program not found.' });
  res.json(publicProgram(p));
});

app.post('/api/programs/:id/verify-pin', (req, res) => {
  const p = q.byId.get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Program not found.' });
  if (!pinLimit(req.ip + ':' + p.id)) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.' });
  res.json({ ok: !p.require_pin || String(req.body?.pin ?? '') === p.pin });
});

app.post('/api/programs/:id/records', (req, res) => {
  const p = q.byId.get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Program not found.' });
  if (p.closed) return res.status(409).json({ error: 'The attendance form is closed.' });
  const b = req.body || {};
  if (p.require_pin) {
    if (!pinLimit(req.ip + ':' + p.id)) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.' });
    if (String(b.pin ?? '') !== p.pin) return res.status(403).json({ error: 'Incorrect PIN. Please ask the secretariat.', field: 'pin' });
  }
  const status = b.status;
  const name = str(b.name, 120);
  const grade = str(b.grade, 20).toUpperCase();
  const dept = p.ask_dept ? str(b.dept, 80) : '';
  const reason = status === 'absent' ? str(b.reason, 200) : '';
  const errors = {};
  if (status !== 'present' && status !== 'absent') errors.status = 'Please choose Present or Absent.';
  if (name.length < 3) errors.name = 'Please enter your full name.';
  if (!grade) errors.grade = 'Please choose your grade.';
  if (p.ask_dept && !dept) errors.dept = 'Please select your department.';
  const { date, time } = nowLocal();
  if (!errors.name && q.dup.get(p.id, date, name)) errors.name = 'This name is already recorded today.';
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  const r = q.insertRecord.run(p.id, name, grade, dept, status, reason, date, time);
  res.status(201).json({ id: Number(r.lastInsertRowid), date, time });
});

// Admin
app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req) }));
app.post('/api/admin/login', (req, res) => {
  if (!loginLimit(req.ip)) return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes.' });
  const given = Buffer.from(String(req.body?.password ?? ''));
  const want = Buffer.from(ADMIN_PASSWORD);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.status(401).json({ error: 'Incorrect password.' });
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `jpps_admin=${makeToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
  res.json({ admin: true });
});
app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'jpps_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ admin: false });
});

app.get('/api/admin/programs', requireAdmin, (req, res) => res.json(q.list.all().map(adminProgram)));
app.get('/api/admin/programs/:id', requireAdmin, (req, res) => {
  const p = q.byId.get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Program not found.' });
  res.json(adminProgram(p));
});
app.post('/api/admin/programs', requireAdmin, (req, res) => {
  const pin = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const r = q.insertProgram.run('Untitled program', '', '', pin);
  res.status(201).json(adminProgram(q.byId.get(Number(r.lastInsertRowid))));
});
app.patch('/api/admin/programs/:id', requireAdmin, (req, res) => {
  const p = q.byId.get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Program not found.' });
  const b = req.body || {};
  const next = {
    name: 'name' in b ? str(b.name, 200) || 'Untitled program' : p.name,
    dates: 'dates' in b ? str(b.dates, 100) : p.dates,
    venue: 'venue' in b ? str(b.venue, 200) : p.venue,
    pin: 'pin' in b ? String(b.pin).replace(/\D/g, '').slice(0, 4) : p.pin,
    require_pin: 'requirePin' in b ? (b.requirePin ? 1 : 0) : p.require_pin,
    ask_dept: 'askDept' in b ? (b.askDept ? 1 : 0) : p.ask_dept,
    closed: 'closed' in b ? (b.closed ? 1 : 0) : p.closed,
  };
  if (next.require_pin && next.pin.length !== 4) return res.status(400).json({ error: 'The PIN must be 4 digits.' });
  db.prepare('UPDATE programs SET name = ?, dates = ?, venue = ?, pin = ?, require_pin = ?, ask_dept = ?, closed = ? WHERE id = ?')
    .run(next.name, next.dates, next.venue, next.pin, next.require_pin, next.ask_dept, next.closed, p.id);
  res.json(adminProgram(q.byId.get(p.id)));
});
app.post('/api/admin/programs/:id/activate', requireAdmin, (req, res) => {
  const p = q.byId.get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Program not found.' });
  q.clearActive.run(); q.setActive.run(p.id);
  res.json(adminProgram(q.byId.get(p.id)));
});
app.delete('/api/admin/programs/:id', requireAdmin, (req, res) => {
  q.deleteProgram.run(Number(req.params.id));
  if (!q.active.get()) { const l = q.latest.get(); if (l) q.setActive.run(l.id); }
  res.json({ ok: true });
});
app.get('/api/admin/programs/:id/records', requireAdmin, (req, res) => {
  res.json(q.records.all(Number(req.params.id)).map(recordOut));
});
app.delete('/api/admin/records/:id', requireAdmin, (req, res) => {
  q.deleteRecord.run(Number(req.params.id));
  res.json({ ok: true });
});

const baseUrl = req => PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
app.get('/api/admin/programs/:id/link', requireAdmin, (req, res) => res.json({ url: `${baseUrl(req)}/?p=${Number(req.params.id)}` }));
app.get('/api/admin/programs/:id/qr.svg', requireAdmin, async (req, res) => {
  const svg = await QRCode.toString(`${baseUrl(req)}/?p=${Number(req.params.id)}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1d1f20', light: '#ffffff' } });
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
});

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtDate = d => { const [y, m, dd] = d.split('-').map(Number); return `${dd} ${MONTHS[m - 1]} ${y}`; };
app.get('/api/admin/programs/:id/export.csv', requireAdmin, (req, res) => {
  const p = q.byId.get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Program not found.' });
  const recs = q.records.all(p.id);
  const present = recs.filter(r => r.status === 'present').length;
  const c = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [[config.orgName], ['Program', p.name], ['Program dates', p.dates], ['Venue', p.venue], ['Present', present], ['Absent', recs.length - present], [],
    ['No', 'Name', 'Grade', 'Department', 'Status', 'Reason', 'Date', 'Time']];
  recs.forEach((r, i) => lines.push([i + 1, r.name, r.grade, r.dept, r.status === 'present' ? 'Present' : 'Absent', r.reason, fmtDate(r.date), r.time]));
  const file = `attendance-${p.name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || p.id}.csv`;
  res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${file}"`)
    .send('﻿' + lines.map(l => l.map(c).join(',')).join('\r\n'));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(PORT, () => console.log(`Attendance system on http://localhost:${PORT}`));
