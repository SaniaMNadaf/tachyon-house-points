// SQLite setup: tables, first-run super admin and optional sample data.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const HOUSES = ['alpha', 'infer', 'matrix', 'layer'];

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('super','admin')),
      active        INTEGER NOT NULL DEFAULT 1,
      must_change   INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      house      TEXT NOT NULL CHECK (house IN ('alpha','infer','matrix','layer')),
      points     INTEGER NOT NULL CHECK (points <> 0),
      reason     TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      admin_id   INTEGER REFERENCES admins(id) ON DELETE SET NULL,
      admin_name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);
  return db;
}

// Creates the first super admin when the admins table is empty.
// Returns { username, password, generated } when it created one, otherwise null.
function ensureSuperAdmin(db, env = process.env) {
  if (db.prepare('SELECT COUNT(*) AS n FROM admins').get().n > 0) return null;
  const username = (env.ADMIN_USERNAME || 'admin').trim();
  let password = env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    generated = true;
  }
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO admins (username, password_hash, role, must_change, created_at) VALUES (?,?,?,?,?)')
    .run(username, hash, 'super', generated ? 1 : 0, Date.now());
  return { username, password, generated };
}

// Sample data so the site is not empty on a fresh install (same numbers as the prototype).
function seedSample(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM entries').get().n > 0) return false;
  const H = 3600e3, now = Date.now();
  const rows = [];
  const add = (house, hrs, pts, reason) => rows.push([house, pts, reason, now - hrs * H]);
  add('alpha',2,15,'Speed Test'); add('alpha',5,20,'Debug Duel'); add('alpha',26,-10,'Code penalty'); add('alpha',50,50,'Design Win');
  add('alpha',9*24,40,'Orientation Quiz'); add('alpha',16*24,35,'Coding Relay'); add('alpha',23*24,45,'Hackathon Round 1'); add('alpha',30*24,50,'Design Sprint'); add('alpha',37*24,45,'Welcome Challenge');
  add('infer',3,15,'Submission'); add('infer',6,20,'System Hack'); add('infer',27,-10,'Penalty: delay');
  add('infer',8*24,35,'Logic Quiz'); add('infer',15*24,40,'Code Relay'); add('infer',22*24,40,'Hackathon Round 1'); add('infer',29*24,45,'Design Sprint'); add('infer',36*24,35,'Welcome Challenge');
  add('matrix',4,15,'Captured Node'); add('matrix',7,20,'System Control'); add('matrix',12,10,'Puzzle Solve'); add('matrix',50,10,'Code Challenge');
  add('matrix',9*24,50,'Logic Quiz'); add('matrix',16*24,45,'Coding Relay'); add('matrix',24*24,55,'Hackathon Round 1'); add('matrix',31*24,60,'Design Sprint'); add('matrix',38*24,45,'Welcome Challenge');
  add('layer',2,15,'Speed Test'); add('layer',5,15,'Challenge'); add('layer',28,-15,'Penalty: fault'); add('layer',52,20,'Task Bonus');
  add('layer',8*24,30,'Logic Quiz'); add('layer',17*24,40,'Code Relay'); add('layer',22*24,35,'Hackathon Round 1'); add('layer',30*24,45,'Design Sprint'); add('layer',37*24,35,'Welcome Challenge');
  const ins = db.prepare('INSERT INTO entries (house, points, reason, created_at, admin_id, admin_name) VALUES (?,?,?,?,NULL,?)');
  db.transaction(() => rows.forEach((r) => ins.run(r[0], r[1], r[2], r[3], 'sample data')))();
  return true;
}

module.exports = { openDb, ensureSuperAdmin, seedSample, HOUSES };
