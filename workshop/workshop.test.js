const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createWorkshop } = require('./server.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function setup(t) {
  const app = createWorkshop({ codes: ['pair-a', 'pair-b'] });
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
  const rivalA = (await call('/vulnerable/profiles/102', a)).data;
  const rivalB = (await call('/vulnerable/profiles/102', b)).data;
  assert.notEqual(rivalA.memo, rivalB.memo);
  const evidence = rivalA.memo.split('：')[1];
  assert.equal((await call('/vulnerable/claims', a, { challenge: 'idor', evidence, generation: s.generation })).status, 200);
  const sb = (await call('/vulnerable/status', b)).data;
  assert.equal((await call('/vulnerable/claims', b, { challenge: 'idor', evidence, generation: sb.generation })).status, 400);
  assert.deepEqual(sb.solved, []);
});
test('SQLi: 実SQLで非掲載登録名が漏れ、パラメータ化した修正版では漏れない', async t => {
  const { call, a } = await setup(t);
  for (const mode of ['vulnerable', 'fixed']) {
    const normal = await call(`/${mode}/directory?q=${encodeURIComponent('ゲスト')}`, a);
    assert.deepEqual(normal.data.rows.map(r => r.name), ['ゲスト猫']);
  }
  const input = encodeURIComponent("' OR 1=1 -- ");
  const result = (await call(`/vulnerable/directory?q=${input}`, a)).data;
  assert.equal(result.rows.length, 4); assert.ok(result.evidence.startsWith('NAME-'));
  const fixed = (await call(`/fixed/directory?q=${input}`, a)).data;
  assert.deepEqual(fixed.rows, []); assert.equal(fixed.evidence, undefined);
  const postResult = await call('/vulnerable/directory', a, { q: "' OR 1=1 -- " });
  assert.equal(postResult.status, 200); assert.equal(postResult.data.rows.length, 4);
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
  assert.equal(rank.rows[0].name, payload);
  assert.equal((await call('/vulnerable/ranking', b)).data.rows[0].name, 'あなた');
  assert.equal((await call('/fixed/ranking', a)).data.rows[0].name, 'あなた');
  await call('/vulnerable/reset', a, {});
  assert.equal((await call('/vulnerable/profile', a, save)).status, 409);
  assert.equal((await call('/vulnerable/claims', a, { challenge: 'xss', evidence: rank.ticket, generation: status.generation })).status, 409);
  assert.equal((await call('/vulnerable/ranking', a)).data.rows[0].name, 'あなた');
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
test('実際のゲーム記録: 保存後にマイページ統計・ランキングへ反映、他領域と比較モードへ漏れない', async t => {
  const { call, a, b } = await setup(t);
  const generation = (await call('/vulnerable/status', a)).data.generation;
  const play = { score: 12000, solved: 3, answered: 5, bestStreak: 2, generation };
  const saved = await call('/vulnerable/plays', a, play);
  assert.equal(saved.status, 200);
  const profile = (await call('/vulnerable/profiles/101', a)).data;
  assert.equal(profile.best, 12000);
  assert.equal(profile.plays, 2);
  assert.equal(profile.history[0].id, saved.data.id);
  assert.equal((await call('/vulnerable/ranking', a)).data.rows[0].score, 12000);
  assert.equal((await call('/vulnerable/ranking', b)).data.rows[0].score, 3200);
  assert.equal((await call('/fixed/ranking', a)).data.rows[0].score, 3200);
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
  assert.equal((await call('/vulnerable/directory', a, injection)).data.rows.length, 4);
  assert.deepEqual((await call('/fixed/directory', a, injection)).data.rows, []);
  assert.equal((await call('/fixed/directory', a, wire({ q: 'ゲスト' }))).data.rows[0].name, 'ゲスト猫');
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
  assert.equal((await call('/vulnerable/directory', b, { q: "' OR 1=1 -- " })).data.rows.some(r => r.name === '変更後'), false);
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
  assert.equal((await rival.json()).name, 'ライバル猫');
  assert.equal((await fetch(base + '/api/fixed/profiles/' + other, { headers: { Authorization: 'Bearer ' + a } })).status, 404);
  const generation = (await call('/vulnerable/status', a)).data.generation;
  await call('/vulnerable/plays', a, { generation, score: 9000, solved: 1, answered: 1, bestStreak: 1 });
  assert.equal((await call('/vulnerable/profiles/' + me, a)).data.history[0].userId, me);
  await call('/vulnerable/reset', a, {});
  assert.equal((await call('/vulnerable/status', a)).data.me, me);
});
