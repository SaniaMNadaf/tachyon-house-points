// The Express app: public read API, admin login, admin-only write API.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { HOUSES } = require('./db');

const COOKIE = 'tachyon_sid';
const SESSION_MS = 12 * 3600e3;
const USERNAME_RE = /^[a-z0-9_.-]{3,24}$/i;
// A real bcrypt hash of a random string, compared against when the username does not exist,
// so a wrong username and a wrong password take the same time.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(12).toString('hex'), 12);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const bad = (res, status, error) => res.status(status).json({ error });

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (Buffer.byteLength(pw) > 72) return 'Password is too long (72 bytes max).';
  return null;
}

function createApp(db, opts = {}) {
  const app = express();
  const secureCookie = opts.secureCookie ?? process.env.NODE_ENV === 'production';
  if (secureCookie) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    next();
  });

  // Block cross-site writes: if the browser says where the request came from, it must be this site.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.get('origin');
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { return bad(res, 403, 'Bad origin.'); }
      if (host !== req.get('host')) return bad(res, 403, 'Cross-site request blocked.');
    }
    next();
  });

  // ---- sessions ----
  const stmt = {
    byToken: db.prepare(`SELECT a.id, a.username, a.role, a.active, a.must_change, s.expires_at
                         FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?`),
    addSession: db.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?,?,?)'),
    delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    delAdminSessions: db.prepare('DELETE FROM sessions WHERE admin_id = ?'),
    delExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  };

  function readCookie(req) {
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return null;
  }
  function setCookie(res, token, maxAgeMs) {
    res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secureCookie ? '; Secure' : ''}`);
  }

  app.use((req, res, next) => {
    req.admin = null;
    const token = readCookie(req);
    if (token) {
      const row = stmt.byToken.get(sha(token));
      if (row && row.expires_at > Date.now() && row.active) req.admin = row;
      else if (row) stmt.delSession.run(sha(token));
    }
    next();
  });

  const needAdmin = (req, res, next) => (req.admin ? next() : bad(res, 401, 'Please sign in.'));
  const needReady = (req, res, next) => (req.admin.must_change ? bad(res, 403, 'Set a new password first.') : next());
  const needSuper = (req, res, next) => (req.admin.role === 'super' ? next() : bad(res, 403, 'Super admin only.'));
  const publicAdmin = (a) => ({ id: a.id, username: a.username, role: a.role, mustChange: !!a.must_change });

  // ---- public ----
  const listEntries = db.prepare(`SELECT id, house, points, reason, created_at AS ts, admin_name AS by
                                  FROM entries ORDER BY created_at DESC, id DESC`);
  app.get('/api/entries', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(listEntries.all().map((e) => ({ ...e, id: String(e.id) })));
  });

  app.get('/api/me', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ admin: req.admin ? publicAdmin(req.admin) : null });
  });

  // ---- login / logout ----
  const loginLimiter = rateLimit({
    windowMs: 15 * 60e3,
    limit: opts.loginLimit ?? 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many failed attempts. Try again in 15 minutes.' },
  });

  app.post('/api/login', loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') return bad(res, 400, 'Enter a username and password.');
    const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(username.trim());
    const ok = bcrypt.compareSync(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok || !row.active) return bad(res, 401, 'Wrong username or password.');
    stmt.delExpired.run(Date.now());
    const token = crypto.randomBytes(32).toString('base64url');
    stmt.addSession.run(sha(token), row.id, Date.now() + SESSION_MS);
    setCookie(res, token, SESSION_MS);
    res.json({ admin: publicAdmin(row) });
  });

  app.post('/api/logout', (req, res) => {
    const token = readCookie(req);
    if (token) stmt.delSession.run(sha(token));
    setCookie(res, '', 0);
    res.json({ ok: true });
  });

  // ---- own account ----
  app.post('/api/me/password', needAdmin, (req, res) => {
    const { current, next: nextPw } = req.body || {};
    const row = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
    if (typeof current !== 'string' || !bcrypt.compareSync(current, row.password_hash)) return bad(res, 400, 'Current password is wrong.');
    const problem = checkPassword(nextPw);
    if (problem) return bad(res, 400, problem);
    if (nextPw === current) return bad(res, 400, 'Choose a different password from the current one.');
    db.prepare('UPDATE admins SET password_hash = ?, must_change = 0 WHERE id = ?').run(bcrypt.hashSync(nextPw, 12), row.id);
    // sign out every other session of this account
    const keep = sha(readCookie(req));
    db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token_hash <> ?').run(row.id, keep);
    res.json({ ok: true });
  });

  // ---- points (admins) ----
  const insEntry = db.prepare('INSERT INTO entries (house, points, reason, created_at, admin_id, admin_name) VALUES (?,?,?,?,?,?)');
  app.post('/api/entries', needAdmin, needReady, (req, res) => {
    const { house, points, reason } = req.body || {};
    if (!HOUSES.includes(house)) return bad(res, 400, 'Choose one of the four houses.');
    if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 1000) return bad(res, 400, 'Points must be a whole number between -1000 and 1000, not 0.');
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (!why) return bad(res, 400, 'Add a short reason.');
    if (why.length > 80) return bad(res, 400, 'Reason must be 80 characters or fewer.');
    const info = insEntry.run(house, points, why, Date.now(), req.admin.id, req.admin.username);
    res.status(201).json({ id: String(info.lastInsertRowid) });
  });

  app.delete('/api/entries/:id', needAdmin, needReady, (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return bad(res, 400, 'Bad id.');
    const info = db.prepare('DELETE FROM entries WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) return bad(res, 404, 'Entry not found.');
    res.json({ ok: true });
  });

  // ---- manage admins (super admin) ----
  const countSupers = db.prepare("SELECT COUNT(*) AS n FROM admins WHERE role = 'super' AND active = 1");
  app.get('/api/admins', needAdmin, needReady, needSuper, (req, res) => {
    const rows = db.prepare('SELECT id, username, role, active, must_change, created_at FROM admins ORDER BY id').all();
    res.json(rows.map((r) => ({ id: r.id, username: r.username, role: r.role, active: !!r.active, mustChange: !!r.must_change, createdAt: r.created_at })));
  });

  app.post('/api/admins', needAdmin, needReady, needSuper, (req, res) => {
    const { username, password, role } = req.body || {};
    if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) return bad(res, 400, 'Username: 3-24 letters, numbers, dot, dash or underscore.');
    const problem = checkPassword(password);
    if (problem) return bad(res, 400, problem);
    const r = role === 'super' ? 'super' : 'admin';
    try {
      const info = db.prepare('INSERT INTO admins (username, password_hash, role, must_change, created_at) VALUES (?,?,?,1,?)')
        .run(username.trim(), bcrypt.hashSync(password, 12), r, Date.now());
      res.status(201).json({ id: info.lastInsertRowid });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return bad(res, 409, 'That username is already taken.');
      throw e;
    }
  });

  // enable/disable an account, or set a new temporary password
  app.patch('/api/admins/:id', needAdmin, needReady, needSuper, (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return bad(res, 400, 'Bad id.');
    const id = Number(req.params.id);
    const target = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
    if (!target) return bad(res, 404, 'Admin not found.');
    const { active, password } = req.body || {};
    if (typeof active === 'boolean') {
      if (!active) {
        if (id === req.admin.id) return bad(res, 400, "You can't disable your own account.");
        if (target.role === 'super' && target.active && countSupers.get().n <= 1) return bad(res, 400, 'Keep at least one active super admin.');
      }
      db.prepare('UPDATE admins SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
      if (!active) stmt.delAdminSessions.run(id);
    }
    if (password !== undefined) {
      const problem = checkPassword(password);
      if (problem) return bad(res, 400, problem);
      db.prepare('UPDATE admins SET password_hash = ?, must_change = 1 WHERE id = ?').run(bcrypt.hashSync(password, 12), id);
      stmt.delAdminSessions.run(id);
      if (id === req.admin.id) setCookie(res, '', 0);
    }
    if (typeof active !== 'boolean' && password === undefined) return bad(res, 400, 'Nothing to change.');
    res.json({ ok: true });
  });

  app.use('/api', (req, res) => bad(res, 404, 'Not found.'));
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return bad(res, 400, 'Bad JSON.');
    console.error(err);
    bad(res, 500, 'Server error.');
  });

  // ---- the website itself ----
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
  return app;
}

module.exports = { createApp };
