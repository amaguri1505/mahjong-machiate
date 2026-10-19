const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createWorkshop } = require('./server.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function setup(t) {
  const app = createWorkshop({ memory: true, codes: ['pair-a', 'pair-b'] });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function call(path, token, body, extra = {}) {
    if (path.endsWith('/profiles/101') || path.endsWith('/profiles/102')) {
      const mode = path.split('/')[1];
      const me = (await call('/' + mode + '/status', token)).data.me;
      path = '/' + mode + '/profiles/' + (me + (path.endsWith('/102') ? 1 : 0));
    }
    const response = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  const a = (await call('/session', null, { code: 'pair-a', name: 'あなた' })).data.token;
  const b = (await call('/session', null, { code: 'pair-b', name: 'あなた' })).data.token;
  return { call, a, b, base };
}
test('演習API: 認証・オリジン・入力サイズと通常版ファイルへのアクセスを制限', async t => {
  const { call, a, base } = await setup(t);
  assert.equal((await call('/vulnerable/status')).status, 401);
  assert.equal((await call('/session', null, { code: 'wrong' })).status, 401);
  assert.equal((await call('/vulnerable/status', a, undefined, { Origin: 'https://outside.invalid' })).status, 403);
  assert.equal((await call('/vulnerable/profile', a, { name: 'a'.repeat(9000) })).status, 413);
  assert.equal((await fetch(base + '/online.js')).status, 404);
  assert.equal((await fetch(base + '/supabase/schema.sql')).status, 404);
});
test('IDOR: 同領域の他人だけを取得、固定版で拒否、別ペアの証拠を受理しない', async t => {
  const { call, a, b } = await setup(t);
  const s = (await call('/vulnerable/status', a)).data;
  assert.equal((await call('/fixed/profiles/101', a)).status, 200);
  assert.equal((await call('/fixed/profiles/102', a)).status, 404);
  const target = (await call('/session', null, { code: 'pair-a', name: '実ユーザー' })).data;
  const id = (await call('/vulnerable/status', target.token)).data.me;
  const generation = (await call('/vulnerable/status', target.token)).data.generation;
  await call('/vulnerable/plays', target.token, { generation, score: 6400, solved: 1, answered: 1, bestStreak: 1 });
  await call('/vulnerable/profile', target.token, { generation, name: '実ユーザー', published: false });
  const rivalA = (await call('/vulnerable/profiles/' + id, a)).data;
  assert.equal(rivalA.name, '実ユーザー');
  assert.equal(rivalA.best, 6400);
  assert.equal(rivalA.published, false);
  assert.equal(rivalA.history[0].userId, id);
  assert.equal((await call('/vulnerable/profiles/' + id, b)).status, 404);
  assert.equal((await call('/fixed/profiles/' + id, a)).status, 404);
  assert.equal((await call('/vulnerable/profiles/999999', a)).status, 404);
  const evidence = rivalA.evidence;
  assert.equal((await call('/vulnerable/claims', a, { challenge: 'idor', evidence, generation: s.generation })).status, 200);
  const sb = (await call('/vulnerable/status', b)).data;
  assert.equal((await call('/vulnerable/claims', b, { challenge: 'idor', evidence, generation: sb.generation })).status, 400);
  assert.deepEqual(sb.solved, []);
});
test('SQLi: 実SQLで非掲載登録名が漏れ、パラメータ化した修正版では漏れない', async t => {
  const { call, a } = await setup(t);
  for (const mode of ['vulnerable', 'fixed']) {
    const normal = await call(`/${mode}/directory?q=${encodeURIComponent('あなた')}`, a);
    assert.deepEqual(normal.data.rows.map(r => r.name), ['あなた']);
  }
  const input = encodeURIComponent("' OR 1=1 -- ");
  const result = (await call(`/vulnerable/directory?q=${input}`, a)).data;
  assert.equal(result.rows.length, 3); assert.ok(result.evidence.startsWith('NAME-'));
  const fixed = (await call(`/fixed/directory?q=${input}`, a)).data;
  assert.deepEqual(fixed.rows, []); assert.equal(fixed.evidence, undefined);
  const postResult = await call('/vulnerable/directory', a, { q: "' OR 1=1 -- " });
  assert.equal(postResult.status, 200); assert.equal(postResult.data.rows.length, 3);
  assert.deepEqual((await call('/fixed/directory', a, { q: "' OR 1=1 -- " })).data.rows, []);
  const generation = (await call('/vulnerable/status', a)).data.generation;
  assert.equal((await call('/vulnerable/claims', a, { challenge: 'sqli', evidence: result.evidence, generation })).status, 200);
  assert.equal((await call(`/vulnerable/directory?q=${encodeURIComponent("' UNION SELECT 0, name, 0 FROM sqlite_master -- ")}`, a)).status, 200);
  // 名前保存・成功判定用の状態はSQLi接続のDBに存在しない。
  assert.equal((await call(`/vulnerable/directory?q=${encodeURIComponent("' UNION SELECT 0, value, 0 FROM state -- ")}`, a)).status, 400);
});
test('保存名: 同じペア内で永続、他ペア・修正版と分離、リセット後の旧要求を拒否', async t => {
  const { call, a, b } = await setup(t);
  const status = (await call('/vulnerable/status', a)).data;
  const payload = '<img src=x onerror="celebrate()">';
  const save = { name: payload, generation: status.generation, lab_id: 'pair-b', user_id: 102 };
  assert.equal((await call('/vulnerable/profile', a, save)).status, 200);
  const rank = (await call('/vulnerable/ranking', a)).data;
  assert.equal(rank.preview.name, payload);
  assert.equal((await call('/vulnerable/ranking', b)).data.preview.name, 'あなた');
  assert.equal((await call('/fixed/ranking', a)).data.preview.name, 'あなた');
  await call('/vulnerable/reset', a, {});
  assert.equal((await call('/vulnerable/profile', a, save)).status, 409);
  assert.equal((await call('/vulnerable/claims', a, { challenge: 'xss', evidence: rank.ticket, generation: status.generation })).status, 409);
  assert.equal((await call('/vulnerable/ranking', a)).data.preview.name, 'あなた');
});
test('XSS成功通知: 修正版と無効チケットは拒否、チケットは一回だけ使える', async t => {
  const { call, a } = await setup(t);
  const rank = (await call('/vulnerable/ranking', a)).data;
  const body = { challenge: 'xss', evidence: rank.ticket, generation: rank.generation };
  assert.equal((await call('/vulnerable/claims', a, { ...body, evidence: 'wrong' })).status, 400);
  assert.equal((await call('/vulnerable/claims', a, body)).status, 200);
  assert.equal((await call('/vulnerable/claims', a, body)).status, 400);
  const fixed = (await call('/fixed/ranking', a)).data;
  assert.equal((await call('/fixed/claims', a, { challenge: 'xss', evidence: fixed.ticket, generation: fixed.generation })).status, 400);
});
test('Supabase準備: ペア別資格情報、権限分離、秘密ファイルの制限、既存出力の上書き拒否', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mahjong-workshop-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const out = path.join(temp, 'setup');
  const script = path.join(__dirname, 'prepare-supabase.js');
  const result = spawnSync(process.execPath, [script, '2', out], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const sql = fs.readFileSync(path.join(out, 'setup.sql'), 'utf8');
  const secrets = fs.readFileSync(path.join(out, 'secrets.env'), 'utf8');
  const labs = JSON.parse(secrets.split('\n').find(line => line.startsWith('WORKSHOP_LABS=')).slice('WORKSHOP_LABS='.length));
  assert.equal(labs.length, 2);
  assert.notEqual(labs[0].code, labs[1].code);
  assert.notEqual(new URL(labs[0].readUrl).password, new URL(labs[1].readUrl).password);
  for (const lab of labs) {
    assert.match(lab.code, /^(neko|tile)-[a-z2-9]{5}$/);
    assert.equal(lab.code.length, 10);
    assert.match(sql, new RegExp(`GRANT SELECT ON ${lab.schema}\\.directory TO ${lab.schema}_reader;`));
    assert.match(sql, new RegExp(`GRANT SELECT, INSERT, UPDATE ON ${lab.schema}\\.state TO ${lab.schema}_writer;`));
    assert.ok(!result.stdout.includes(lab.code));
    assert.ok(!result.stdout.includes(new URL(lab.readUrl).password));
  }
  assert.equal(fs.statSync(path.join(out, 'secrets.env')).mode & 0o777, 0o600);
  assert.notEqual(spawnSync(process.execPath, [script, '2', out]).status, 0);
  assert.equal(fs.readFileSync(path.join(out, 'secrets.env'), 'utf8'), secrets);
});
test('元ゲーム統合: ゲーム本体・牌描画・スタイルをそのまま配信、本番接続を含めない', async t => {
  const { base } = await setup(t);
  const html = await (await fetch(base)).text();
  for (const id of ['hand', 'palette', 'timer', 'review-list', 'start-btn', 'my-history', 'profile-form', 'search-form']) {
    assert.ok(html.includes(`id="${id}"`), id);
  }
  assert.ok(!html.includes('src="online.js"'));
  assert.ok(!html.includes('supabase-js'));
  for (const file of ['main.js', 'mahjong-logic.js', 'tile-art.js', 'style.css', 'ranking.js']) {
    const response = await fetch(`${base}/${file}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  }
});
test('実際のゲーム記録: 保存後にマイページ統計・ランキングへ反映、他グループと分離し比較モードでは成績を共有', async t => {
  const { call, a, b } = await setup(t);
  const generation = (await call('/vulnerable/status', a)).data.generation;
  const play = { score: 12000, solved: 3, answered: 5, bestStreak: 2, generation };
  const saved = await call('/vulnerable/plays', a, play);
  assert.equal(saved.status, 200);
  const profile = (await call('/vulnerable/profiles/101', a)).data;
  assert.equal(profile.best, 12000);
  assert.equal(profile.plays, 1);
  assert.equal(profile.history[0].id, saved.data.id);
  assert.equal((await call('/vulnerable/ranking', a)).data.rows[0].score, 12000);
  assert.deepEqual((await call('/vulnerable/ranking', b)).data.rows, []);
  assert.equal((await call('/fixed/ranking', a)).data.rows[0].score, 12000);
  await call('/vulnerable/profile', a, { name: 'テスト猫', generation });
  assert.equal((await call('/vulnerable/leaderboard', a)).data.rows[0].name, 'テスト猫');
  assert.equal((await call('/vulnerable/plays', a, { ...play, score: -1 })).status, 400);
  await call('/vulnerable/reset', a, {});
  assert.equal((await call('/vulnerable/plays', a, play)).status, 409);
});
test('Supabaseモード: 専用APIのURLとCSPのみを配信し、ローカルAPIへフォールバックしない', async t => {
  const app = createWorkshop({ supabase: true });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const config = await fetch(base + '/config.js');
  assert.match(await config.text(), /https:\/\/xroxdmybbpxulqgezvnh\.supabase\.co\/functions\/v1\/workshop/);
  assert.ok(config.headers.get('content-security-policy').includes("connect-src 'self' https://xroxdmybbpxulqgezvnh.supabase.co"));
  assert.equal((await fetch(base + '/api/vulnerable/status')).status, 404);
  assert.equal((await fetch(base + '/.setup/xroxdmybbpxulqgezvnh/secrets.env')).status, 404);
  assert.deepEqual(app.codes, []);
});
test('転送形式: UTF-8本文を復号し、弱点版と修正版の差を維持、不正本文は拒否', async t => {
  const { call, a } = await setup(t);
  const wire = value => ({ encoding: 'base64-json', data: Buffer.from(JSON.stringify(value)).toString('base64') });
  const injection = wire({ q: "' OR 1=1 -- " });
  assert.equal((await call('/vulnerable/directory', a, injection)).data.rows.length, 3);
  assert.deepEqual((await call('/fixed/directory', a, injection)).data.rows, []);
  assert.equal((await call('/fixed/directory', a, wire({ q: 'あなた' }))).data.rows[0].name, 'あなた');
  assert.equal((await call('/vulnerable/directory', a, { encoding: 'base64-json', data: '%' })).status, 400);
  assert.equal((await call('/vulnerable/directory', a, wire(null))).status, 400);
});

test('参加者登録: 同じコード・同じ名前でも進捗と名前とリセットを分離する', async t => {
  const { call, a } = await setup(t);
  const b = (await call('/session', null, { code: 'pair-a', name: 'あなた' })).data.token;
  assert.ok(b); assert.notEqual(a, b);
  assert.equal((await call('/session', null, { code: 'pair-a', name: '  ' })).status, 400);
  const generation = (await call('/vulnerable/status', a)).data.generation;
  await call('/vulnerable/profile', a, { name: '変更後', generation });
  const evidence = (await call('/vulnerable/directory', a, { q: "' OR 1=1 -- " })).data.evidence;
  assert.equal((await call('/vulnerable/claims', a, { challenge: 'sqli', evidence, generation })).status, 200);
  assert.equal((await call('/vulnerable/profiles/101', b)).data.name, 'あなた');
  assert.deepEqual((await call('/vulnerable/status', b)).data.solved, []);
  assert.equal((await call('/vulnerable/directory', b, { q: "' OR 1=1 -- " })).data.rows.some(r => r.name === '変更後'), true);
  await call('/vulnerable/reset', b, {});
  assert.deepEqual((await call('/vulnerable/status', a)).data.solved, ['sqli']);
  assert.equal((await call('/vulnerable/profiles/101', a)).data.name, '変更後');
  assert.equal((await call('/fixed/profiles/101', a)).data.name, 'あなた');
});

test('ユーザーID: 登録ごとに固有ID、記録・リセットで維持、他の実参加者は閲覧不可', async t => {
  const { call, a, b, base } = await setup(t);
  const me = (await call('/vulnerable/status', a)).data.me;
  const other = (await call('/vulnerable/status', b)).data.me;
  assert.equal(me, 101); assert.equal(other, 102);
  assert.equal((await call('/vulnerable/profiles/' + me, a)).data.id, me);
  const rival = await fetch(base + '/api/vulnerable/profiles/' + other, { headers: { Authorization: 'Bearer ' + a } });
  assert.equal(rival.status, 404);
  assert.equal((await fetch(base + '/api/fixed/profiles/' + other, { headers: { Authorization: 'Bearer ' + a } })).status, 404);
  const generation = (await call('/vulnerable/status', a)).data.generation;
  await call('/vulnerable/plays', a, { generation, score: 9000, solved: 1, answered: 1, bestStreak: 1 });
  assert.equal((await call('/vulnerable/profiles/' + me, a)).data.history[0].userId, me);
  await call('/vulnerable/reset', a, {});
  assert.equal((await call('/vulnerable/status', a)).data.me, me);
});

test('成績: 同名で再参加しても0から開始し、最高点・回数・履歴を独立して保持', async t => {
  const { call, a } = await setup(t);
  const b = (await call('/session', null, { code: 'pair-a', name: 'あなた' })).data.token;
  const profile = async token => {
    const me = (await call('/vulnerable/status', token)).data.me;
    return (await call('/vulnerable/profiles/' + me, token)).data;
  };
  for (const token of [a, b]) {
    const p = await profile(token);
    assert.equal(p.best, 0); assert.equal(p.plays, 0); assert.deepEqual(p.history, []);
    assert.deepEqual((await call('/vulnerable/leaderboard', token)).data.rows, []);
  }
  for (const [token, scores] of [[a, [9000, 3000]], [b, [1500]]]) {
    const generation = (await call('/vulnerable/status', token)).data.generation;
    for (const score of scores) {
      assert.equal((await call('/vulnerable/plays', token, { generation, score, solved: 1, answered: 2, bestStreak: 1 })).status, 200);
    }
  }
  assert.equal((await profile(a)).best, 9000); assert.equal((await profile(a)).plays, 2);
  assert.equal((await profile(b)).best, 1500); assert.equal((await profile(b)).plays, 1);
  await call('/vulnerable/reset', b, {});
  assert.equal((await profile(b)).plays, 1); assert.equal((await profile(b)).best, 1500);
  assert.equal((await profile(a)).plays, 2); assert.equal((await profile(a)).best, 9000);
});

test('旧サンプル記録だけを除外し、実際のプレイ記録は維持する', async () => {
  const { seed, dispatch } = require('./supabase/functions/_shared/core.js');
  const state = { ...seed(101), userId: 101, games: [
    { id: 'seed-self', userId: 101, score: 3200 },
    { id: 'seed-guest', userId: 103, score: 1600 },
    { id: 'real-play', userId: 101, score: 1000, at: 1 }
  ] };
  const p = await dispatch({ method: 'GET', path: '/profiles/101', state, mode: 'fixed' });
  assert.equal(p.best, 1000); assert.equal(p.plays, 1);
  assert.equal(p.history[0].id, 'real-play');
});

test('ランキング: IDごとの最高点を1件だけ掲載し、同点は先の記録、履歴は全件保持', async () => {
  const { seed, dispatch } = require('./supabase/functions/_shared/core.js');
  const games = Array.from({ length: 12 }, (_, i) => ({ id: `play-${i}`, userId: 101, score: 9000, at: i + 10 }));
  games.push({ id: 'earliest-best', userId: 101, score: 9000, at: 1 });
  games.push({ id: 'lower', userId: 101, score: 1000, at: 0 });
  games.push({ id: 'other-best', userId: 102, score: 8000, at: 2 });
  games.push({ id: 'other-lower', userId: 102, score: 2000, at: 3 });
  for (let i = 103; i <= 114; i++) games.push({ id: `user-${i}`, userId: i, score: 7000 - i, at: i });
  const state = { ...seed(101), userId: 101, name: '本人', games };
  for (const mode of ['vulnerable', 'fixed']) {
    for (const path of ['/leaderboard', '/ranking']) {
      const { rows } = await dispatch({ method: 'GET', path, state, mode });
      assert.equal(rows.length, 10);
      assert.equal(new Set(rows.map(p => p.userId)).size, 10);
      assert.equal(rows[0].id, 'earliest-best');
      assert.equal(rows[1].id, 'other-best');
      assert.equal(rows[0].name, '本人');
    }
    const profile = await dispatch({ method: 'GET', path: '/profiles/101', state, mode });
    assert.equal(profile.plays, 14);
    assert.equal(profile.best, 9000);
  }
  assert.deepEqual(state.games, games);
});

test('新規参加: 名前とコードだけで毎回別ID、ログアウトと再起動後もランキングは保持', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-participants-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'game.sqlite');
  let app, base;
  async function start() {
    app = createWorkshop({ databasePath, codes: ['pair-a', 'pair-b'] });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    base = `http://127.0.0.1:${app.server.address().port}/api`;
  }
  t.after(() => app?.close());
  const call = async (route, token, body) => {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  await start();
  const registration = { code: 'pair-a', name: '同じ名前' };
  const first = (await call('/session', null, registration)).data;
  const generation = (await call('/vulnerable/status', first.token)).data.generation;
  for (const score of [5000, 9000, 1000]) assert.equal((await call('/vulnerable/plays', first.token, { generation, score, solved: 1, answered: 2, bestStreak: 1 })).status, 200);
  assert.equal((await call('/logout', first.token, {})).status, 200);
  assert.equal((await call('/logout', first.token, {})).status, 200);
  assert.equal((await call('/vulnerable/status', first.token)).status, 401);
  assert.equal((await call('/session', null, { ...registration, action: 'login' })).status, 400);
  app.close(); app = null;
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec("INSERT INTO accounts (id, lab_id, name, states) SELECT 900, lab_id, name, states FROM accounts WHERE id = 101");
  db.close();
  await start();
  const results = await Promise.all([1, 2].map(() => call('/session', null, registration)));
  assert.ok(results.every(r => r.status === 200 && r.data.participant > 900));
  assert.equal(new Set(results.map(r => r.data.participant)).size, 2);
  const fresh = results[0].data;
  const profile = (await call(`/vulnerable/profiles/${fresh.participant}`, fresh.token)).data;
  assert.equal(profile.best, 0); assert.equal(profile.plays, 0);
  for (const mode of ['vulnerable', 'fixed']) {
    const rows = (await call(`/${mode}/leaderboard`, fresh.token)).data.rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].userId, first.participant); assert.equal(rows[0].score, 9000);
  }
});

test('旧DB移行: ログイン情報を削除し、ユーザーID・記録・セッション・採番を維持', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-legacy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'game.sqlite');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER NOT NULL, login_id TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL, states TEXT NOT NULL, games TEXT NOT NULL DEFAULT '[]');
    INSERT INTO accounts VALUES (800, 1, 'legacy', 'old-hash', '以前のユーザー', '{}', '[{"id":"real-play","userId":800,"score":9000}]');
    UPDATE sqlite_sequence SET seq=900 WHERE name='accounts';
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);
    INSERT INTO sessions VALUES ('existing-session', 800, 9999999999999);`);
  db.close();
  const app = createWorkshop({ databasePath, codes: ['pair-a'] });
  t.after(() => app.close());
  const check = new DatabaseSync(databasePath);
  assert.deepEqual(check.prepare('PRAGMA table_info(accounts)').all().map(c => c.name), ['id', 'lab_id', 'name', 'states', 'games']);
  assert.equal(check.prepare('SELECT user_id FROM sessions').get().user_id, 800);
  assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(check.prepare('SELECT name FROM accounts WHERE id=800').get().name, '以前のユーザー');
  assert.equal(JSON.parse(check.prepare('SELECT games FROM accounts WHERE id=800').get().games)[0].score, 9000);
  assert.equal(check.prepare("SELECT seq FROM sqlite_sequence WHERE name='accounts'").get().seq, 900);
  check.close();
});

test('共有ランキング: 弱点版は他ユーザーの保存名もHTMLとして扱い、修正版では文字列にする', async t => {
  const { call, a } = await setup(t);
  const b = (await call('/session', null, { code: 'pair-a', name: '別ユーザー' })).data.token;
  const status = (await call('/vulnerable/status', a)).data;
  const name = '<img src=x onerror="celebrate()">';
  await call('/vulnerable/profile', a, { name, generation: status.generation });
  await call('/vulnerable/plays', a, { score: 8000, solved: 1, answered: 2, bestStreak: 1, generation: status.generation });
  const own = (await call('/vulnerable/ranking', a)).data;
  assert.equal(own.rows.length, 1); assert.equal(own.rows[0].allowHtml, true);
  const other = (await call('/vulnerable/ranking', b)).data;
  assert.equal(other.rows.length, 1); assert.equal(other.rows[0].name, name);
  assert.equal(other.rows[0].allowHtml, true);
  assert.equal(other.preview.name, '別ユーザー'); assert.equal(other.preview.sample, true);
  assert.equal((await call('/vulnerable/leaderboard', b)).data.rows.length, 1);
  const fixedStatus = (await call('/fixed/status', a)).data;
  await call('/fixed/profile', a, { name, generation: fixedStatus.generation });
  const fixed = (await call('/fixed/ranking', b)).data;
  assert.equal(fixed.fixed, true);
  assert.equal(fixed.rows[0].name, name);
  assert.equal(fixed.rows[0].allowHtml, false);
  assert.equal(fixed.preview.allowHtml, false);
});

test('複数人の同時プレイ: 全員の自己ベストを保存し、全員ログアウト後も新規参加者から読める', async t => {
  const { call } = await setup(t);
  const participants = await Promise.all(Array.from({ length: 12 }, (_, i) => call('/session', null, { code: 'pair-a', name: `同時参加${i}` })));
  assert.ok(participants.every(p => p.status === 200));
  assert.equal(new Set(participants.map(p => p.data.participant)).size, 12);
  await Promise.all(participants.map(async ({ data: user }, i) => {
    const { generation } = (await call('/vulnerable/status', user.token)).data;
    const saved = await Promise.all([1000, 3000, 2000].map(base => call('/vulnerable/plays', user.token, {
      generation, score: base + i * 100, solved: 1, answered: 2, bestStreak: 1
    })));
    assert.ok(saved.every(r => r.status === 200));
    const profile = (await call(`/vulnerable/profiles/${user.participant}`, user.token)).data;
    assert.equal(profile.plays, 3); assert.equal(profile.best, 3000 + i * 100);
    assert.equal((await call('/logout', user.token, {})).status, 200);
  }));
  const viewer = (await call('/session', null, { code: 'pair-a', name: '新しく参加した人' })).data;
  for (const route of ['/vulnerable/leaderboard', '/vulnerable/ranking', '/fixed/leaderboard']) {
    const result = await call(route, viewer.token);
    assert.equal(result.status, 200); assert.equal(result.data.rows.length, 10);
    assert.deepEqual(result.data.rows.map(row => row.score), [4100,4000,3900,3800,3700,3600,3500,3400,3300,3200]);
    assert.equal(new Set(result.data.rows.map(row => row.userId)).size, 10);
  }
});

test('旧メモリ記録の移行: IDの衝突を避け、得点・セッションを保持し、再実行で重複しない', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-import-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const databasePath = path.join(dir, 'game.sqlite');
  const input = path.join(dir, 'snapshot.json');
  const { seed } = require('./supabase/functions/_shared/core');
  const state = { ...seed(101), userId: 101, name: '旧ユーザー', participantName: '旧ユーザー', games: [{ id: 'saved-play', userId: 101, score: 12000, at: 1 }] };
  const token = 'a'.repeat(64);
  fs.writeFileSync(input, JSON.stringify([{ token, expires: Date.now() + 60000, labId: 1, userId: 101, states: { vulnerable: state, fixed: state } }]), { mode: 0o600 });
  const app = createWorkshop({ databasePath }); app.close();
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec("UPDATE sqlite_sequence SET seq=900 WHERE name='accounts'");
  for (let i = 0; i < 2; i++) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'import-legacy.js'), input, 'old-server', databasePath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes(token));
  }
  const rows = db.prepare('SELECT * FROM accounts').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 901);
  const games = JSON.parse(rows[0].games);
  assert.equal(games.length, 1); assert.equal(games[0].score, 12000); assert.equal(games[0].userId, 901);
  assert.equal(db.prepare('SELECT user_id FROM sessions').get().user_id, 901);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('登録者検索: 実ユーザーの表示名・改名・ログアウト後の名前を検索し、別グループや非公開名を除外', async t => {
  const { call, a } = await setup(t);
  const b = (await call('/session', null, { code: 'pair-a', name: '検索できる猫' })).data;
  await call('/session', null, { code: 'pair-b', name: '別グループ猫' });
  for (const mode of ['vulnerable', 'fixed']) {
    const rows = (await call(`/${mode}/directory`, a, { q: '検索できる' })).data.rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].id, b.participant);
    assert.deepEqual((await call(`/${mode}/directory`, a, { q: '別グループ猫' })).data.rows, []);
    assert.deepEqual((await call(`/${mode}/directory`, a, { q: 'ゲスト猫' })).data.rows, []);
  }
  const generation = (await call('/vulnerable/status', b.token)).data.generation;
  const longName = '長い名前'.repeat(70);
  await call('/vulnerable/profile', b.token, { name: longName, generation });
  assert.equal((await call('/vulnerable/directory', a, { q: '長い名前' })).data.rows[0].name, longName);
  await call('/vulnerable/profile', b.token, { name: '非公開の実ユーザー', generation, published: false });
  const injection = (await call('/vulnerable/directory', a, { q: "' OR 1=1 -- " })).data;
  assert.ok(injection.evidence);
  assert.equal(injection.rows.some(r => r.name === '非公開の実ユーザー'), false);
  await call('/vulnerable/profile', b.token, { name: 'ログアウト後の猫', generation, published: true });
  await call('/logout', b.token, {});
  assert.equal((await call('/vulnerable/directory', a, { q: 'ログアウト後' })).data.rows[0].name, 'ログアウト後の猫');
  await Promise.all(Array.from({ length: 55 }, (_, i) => call('/session', null, { code: 'pair-a', name: `多人数${i}` })));
  assert.equal((await call('/vulnerable/directory', a, { q: '多人数' })).data.rows.length, 50);
  assert.ok((await call('/vulnerable/directory', a, { q: "' OR 1=1 -- " })).data.evidence);
});

test('非公開: 本人・他人のランキングから除外し、再公開で保存済み得点を復元する', async t => {
  const { call, a } = await setup(t);
  const viewer = (await call('/session', null, { code: 'pair-a', name: '閲覧者' })).data.token;
  for (const mode of ['vulnerable', 'fixed']) {
    const { me, generation } = (await call(`/${mode}/status`, a)).data;
    await call(`/${mode}/plays`, a, { score: 6400, solved: 1, answered: 1, bestStreak: 1, generation });
    await call(`/${mode}/profile`, a, { name: '非公開の猫', published: false, generation });
    for (const token of [a, viewer]) {
      const ranking = (await call(`/${mode}/ranking`, token)).data;
      assert.equal(ranking.rows.some(row => row.userId === me), false);
      assert.notEqual(ranking.preview?.userId, me);
      assert.equal((await call(`/${mode}/leaderboard`, token)).data.rows.some(row => row.userId === me), false);
    }
    const profile = (await call(`/${mode}/profiles/${me}`, a)).data;
    assert.equal(profile.best, 6400);
    assert.ok(profile.plays > 0);
    await call(`/${mode}/profile`, a, { name: '公開の猫', published: true, generation });
    const rows = (await call(`/${mode}/ranking`, viewer)).data.rows;
    assert.equal(rows.filter(row => row.userId === me).length, 1);
    assert.equal(rows.find(row => row.userId === me).score, 6400);
  }
});
