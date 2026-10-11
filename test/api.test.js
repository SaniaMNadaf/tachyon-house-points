const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, ensureSuperAdmin, seedSample } = require('../server/db');
const { createApp } = require('../server/app');

let server, base;
test.before(async () => {
  const db = openDb(':memory:');
  ensureSuperAdmin(db, { ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'bosspass123' });
  seedSample(db);
  server = createApp(db, { loginLimit: 6 }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

// tiny client that keeps its own cookie, so each "browser" has its own login
function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), setCookie: set };
  };
}

test('anyone can read entries, and they are newest first', async () => {
  const r = await client()('GET', '/api/entries');
  assert.equal(r.status, 200);
  assert.ok(r.data.length > 20);
  for (let i = 1; i < r.data.length; i++) assert.ok(r.data[i - 1].ts >= r.data[i].ts);
  assert.deepEqual(Object.keys(r.data[0]).sort(), ['by', 'house', 'id', 'points', 'reason', 'ts']);
});

test('sample totals match the prototype (A290 I220 M310 L220)', async () => {
  const { data } = await client()('GET', '/api/entries');
  const t = {};
  data.forEach((e) => (t[e.house] = (t[e.house] || 0) + e.points));
  assert.deepEqual(t, { alpha: 290, infer: 220, matrix: 310, layer: 220 });
});

test('writes need a login', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/entries', { house: 'alpha', points: 5, reason: 'x' })).status, 401);
  assert.equal((await c('DELETE', '/api/entries/1')).status, 401);
  assert.equal((await c('GET', '/api/admins')).status, 401);
  assert.equal((await c('GET', '/api/me')).data.admin, null);
});

test('login: wrong password fails, right password sets an httpOnly cookie', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/login', { username: 'boss', password: 'nope' })).status, 401);
  assert.equal((await c('POST', '/api/login', { username: 'ghost', password: 'nope' })).status, 401);
  const ok = await c('POST', '/api/login', { username: 'BOSS', password: 'bosspass123' }); // usernames are case-insensitive
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Lax/);
  assert.equal(ok.data.admin.role, 'super');
  assert.equal(JSON.stringify(ok.data).includes('hash'), false);
  assert.equal((await c('GET', '/api/me')).data.admin.username, 'boss');
});

test('adding points: validation', async () => {
  const c = client();
  await c('POST', '/api/login', { username: 'boss', password: 'bosspass123' });
  const bad = [
    { house: 'zeta', points: 5, reason: 'x' },
    { house: 'alpha', points: 0, reason: 'x' },
    { house: 'alpha', points: 1.5, reason: 'x' },
    { house: 'alpha', points: '5', reason: 'x' },
    { house: 'alpha', points: 1001, reason: 'x' },
    { house: 'alpha', points: 5, reason: '   ' },
    { house: 'alpha', points: 5, reason: 'y'.repeat(81) },
    {},
  ];
  for (const b of bad) assert.equal((await c('POST', '/api/entries', b)).status, 400, JSON.stringify(b));
});

test('adding and removing points updates the totals and records who did it', async () => {
  const c = client();
  await c('POST', '/api/login', { username: 'boss', password: 'bosspass123' });
  const add = await c('POST', '/api/entries', { house: 'alpha', points: 25, reason: 'Test Win' });
  assert.equal(add.status, 201);
  let { data } = await c('GET', '/api/entries');
  assert.equal(data[0].reason, 'Test Win');
  assert.equal(data[0].by, 'boss');
  assert.equal(data.filter((e) => e.house === 'alpha').reduce((s, e) => s + e.points, 0), 315);
  const del = await c('DELETE', '/api/entries/' + add.data.id);
  assert.equal(del.status, 200);
  assert.equal((await c('DELETE', '/api/entries/' + add.data.id)).status, 404);
  ({ data } = await c('GET', '/api/entries'));
  assert.equal(data.filter((e) => e.house === 'alpha').reduce((s, e) => s + e.points, 0), 290);
  const neg = await c('POST', '/api/entries', { house: 'layer', points: -10, reason: 'Penalty' });
  assert.equal(neg.status, 201);
  await c('DELETE', '/api/entries/' + neg.data.id);
});

test('super admin creates an admin with a temporary password; that admin must change it first', async () => {
  const boss = client();
  await boss('POST', '/api/login', { username: 'boss', password: 'bosspass123' });
  assert.equal((await boss('POST', '/api/admins', { username: 'ab', password: 'longenough1' })).status, 400); // short username
  assert.equal((await boss('POST', '/api/admins', { username: 'priya', password: 'short' })).status, 400);   // short password
  const made = await boss('POST', '/api/admins', { username: 'priya', password: 'temp-pass-1' });
  assert.equal(made.status, 201);
  assert.equal((await boss('POST', '/api/admins', { username: 'PRIYA', password: 'temp-pass-1' })).status, 409); // duplicate, any case

  const priya = client();
  const login = await priya('POST', '/api/login', { username: 'priya', password: 'temp-pass-1' });
  assert.equal(login.data.admin.mustChange, true);
  assert.equal((await priya('POST', '/api/entries', { house: 'alpha', points: 5, reason: 'x' })).status, 403);
  assert.equal((await priya('POST', '/api/me/password', { current: 'wrong', next: 'brand-new-pass' })).status, 400);
  assert.equal((await priya('POST', '/api/me/password', { current: 'temp-pass-1', next: 'brand-new-pass' })).status, 200);
  const add = await priya('POST', '/api/entries', { house: 'matrix', points: 10, reason: 'By Priya' });
  assert.equal(add.status, 201);
  assert.equal((await priya('GET', '/api/entries')).data[0].by, 'priya');
  // a normal admin cannot manage admins
  assert.equal((await priya('GET', '/api/admins')).status, 403);
  assert.equal((await priya('POST', '/api/admins', { username: 'sneaky', password: 'longenough1' })).status, 403);
  await boss('DELETE', '/api/entries/' + add.data.id);
});

test('disabling an admin signs them out and blocks login; history keeps their name', async () => {
  const boss = client();
  await boss('POST', '/api/login', { username: 'boss', password: 'bosspass123' });
  await boss('POST', '/api/admins', { username: 'temp1', password: 'temp-pass-2' });
  const t = client();
  await t('POST', '/api/login', { username: 'temp1', password: 'temp-pass-2' });
  await t('POST', '/api/me/password', { current: 'temp-pass-2', next: 'another-pass-9' });
  const e = await t('POST', '/api/entries', { house: 'infer', points: 3, reason: 'temp entry' });
  const list = (await boss('GET', '/api/admins')).data;
  const id = list.find((a) => a.username === 'temp1').id;
  assert.equal((await boss('PATCH', '/api/admins/' + id, { active: false })).status, 200);
  assert.equal((await t('POST', '/api/entries', { house: 'infer', points: 3, reason: 'again' })).status, 401);
  assert.equal((await client()('POST', '/api/login', { username: 'temp1', password: 'another-pass-9' })).status, 401);
  assert.equal((await boss('GET', '/api/entries')).data.find((x) => x.id === e.data.id).by, 'temp1');
  await boss('DELETE', '/api/entries/' + e.data.id);
});

test('reset password forces a change at next login', async () => {
  const boss = client();
  await boss('POST', '/api/login', { username: 'boss', password: 'bosspass123' });
  const id = (await boss('GET', '/api/admins')).data.find((a) => a.username === 'priya').id;
  assert.equal((await boss('PATCH', '/api/admins/' + id, { password: 'reset-pass-77' })).status, 200);
  const r = await client()('POST', '/api/login', { username: 'priya', password: 'reset-pass-77' });
  assert.equal(r.data.admin.mustChange, true);
});

test('you cannot lock yourself out', async () => {
  const boss = client();
  await boss('POST', '/api/login', { username: 'boss', password: 'bosspass123' });
  const me = (await boss('GET', '/api/me')).data.admin;
  assert.equal((await boss('PATCH', '/api/admins/' + me.id, { active: false })).status, 400);
});

test('logout ends the session', async () => {
  const c = client();
  await c('POST', '/api/login', { username: 'boss', password: 'bosspass123' });
  await c('POST', '/api/logout');
  assert.equal((await c('GET', '/api/me')).data.admin, null);
});

test('cross-site writes are blocked', async () => {
  const c = client();
  await c('POST', '/api/login', { username: 'boss', password: 'bosspass123' });
  const r = await c('POST', '/api/entries', { house: 'alpha', points: 5, reason: 'x' }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('bad JSON and unknown routes are handled', async () => {
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
  assert.equal((await client()('GET', '/api/nothing')).status, 404);
});

test('repeated wrong passwords are rate limited (runs last)', async () => {
  const c = client();
  let last;
  for (let i = 0; i < 12; i++) last = await c('POST', '/api/login', { username: 'boss', password: 'wrong' + i });
  assert.equal(last.status, 429);
});
