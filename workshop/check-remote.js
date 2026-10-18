// 検証用の参加者を新規登録して実通信で検証。既存参加者の状態は変更しない。
// 認証トークン・参加コード・DB資格情報は出力しない。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = require('./project.json').projectRef;
const env = fs.readFileSync(path.join(__dirname, '.setup', project, 'secrets.env'), 'utf8');
const labs = JSON.parse(env.split('\n').find(s => s.startsWith('WORKSHOP_LABS=')).slice(14));
const base = `https://${project}.supabase.co/functions/v1/workshop`;
async function call(route, token, body, expected = 200) {
  if (route.endsWith('/profiles/101')) {
    const mode = route.split('/')[1];
    route = '/' + mode + '/profiles/' + (await call('/' + mode + '/status', token)).me;
  }
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', credentials: 'include', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4173', Priority: 'u=1, i', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify({ encoding: 'base64-json', data: Buffer.from(JSON.stringify(body)).toString('base64') }) }) });
  const raw = await response.text();
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error(`${route.split('?')[0]}: HTTP ${response.status} / JSON以外の応答 / ${raw.match(/<title>([^<]*)<\/title>/i)?.[1] || response.headers.get('content-type')}`); }
  if (response.status !== expected) throw new Error(`${route.split('?')[0]}: HTTP ${response.status} / ${value.diagnostic || '応答不一致'}`);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  return value;
}
(async () => {
  const preflight = await fetch(base + '/vulnerable/profiles/101', { method: 'OPTIONS',
    headers: { Origin: 'http://127.0.0.1:4173', 'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type,priority' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  const allowed = preflight.headers.get('access-control-allow-headers').split(',').map(s => s.trim().toLowerCase());
  for (const header of ['authorization', 'content-type', 'priority']) assert.ok(allowed.includes(header));
  console.log('Copy as fetch用CORS: OK');
  const a = (await call('/session', null, { code: labs[0].code, name: '接続確認A' })).token;
  const b = (await call('/session', null, { code: labs[1].code, name: '接続確認B' })).token;
  const sameCode = (await call('/session', null, { code: labs[0].code, name: '接続確認A' })).token;
  console.log('参加認証: OK');
  const status = await call('/vulnerable/status', a);
  assert.equal(typeof status.generation, 'string');
  assert.ok(Array.isArray(status.solved));
  console.log('DBアクセス: OK');
  if (process.argv.includes('--connection-only')) return;
  await call('/vulnerable/status', null, undefined, 401);
  for (const token of [a, b]) for (const mode of ['vulnerable', 'fixed']) await call(`/${mode}/reset`, token, {});
  const sa = await call('/vulnerable/status', a);
  const sb = await call('/vulnerable/status', b);
  const rival = await call('/vulnerable/profiles/102', a);
  await call('/fixed/profiles/102', a, undefined, 404);
  await call('/vulnerable/claims', a, { challenge: 'idor', evidence: rival.memo.split('：')[1], generation: sa.generation });
  await call('/vulnerable/claims', b, { challenge: 'idor', evidence: rival.memo.split('：')[1], generation: sb.generation }, 400);
  console.log('IDOR・修正版・他ペアの証拠拒否: OK');
  const injection = "' OR 1=1 -- ";
  const result = await call('/vulnerable/directory', a, { q: injection });
  assert.equal(result.rows.length, 4);
  assert.equal((await call('/fixed/directory', a, { q: injection })).rows.length, 0);
  assert.equal((await call('/fixed/directory', a, { q: 'ゲスト' })).rows.length, 1);
  await call('/vulnerable/claims', a, { challenge: 'sqli', evidence: result.evidence, generation: sa.generation });
  await call('/vulnerable/directory', a, { q: "' UNION SELECT id::text, name, published FROM lab_2.directory -- " }, 400);
  await call('/vulnerable/directory', a, { q: "' UNION SELECT '0', value::text, 0 FROM lab_1.state -- " }, 400);
  console.log('SQLi・パラメータ化・DB権限による他ペアと状態表の分離: OK');
  const name = '<img src=x onerror="celebrate()">';
  await call('/vulnerable/profile', a, { name, generation: sa.generation });
  assert.equal((await call('/vulnerable/ranking', a)).rows[0].name, name);
  assert.equal((await call('/vulnerable/ranking', b)).rows[0].name, '接続確認B');
  assert.equal((await call('/vulnerable/profiles/101', sameCode)).name, '接続確認A');
  assert.deepEqual((await call('/vulnerable/status', sameCode)).solved, []);
  await call('/vulnerable/reset', sameCode, {});
  assert.ok((await call('/vulnerable/status', a)).solved.includes('sqli'));
  console.log('同じコード・同じ参加者名のユーザー分離: OK');
  await call('/vulnerable/plays', a, { generation: sa.generation, score: 12000, solved: 3, answered: 4, bestStreak: 3 });
  assert.equal((await call('/vulnerable/profiles/101', a)).best, 12000);
  assert.equal((await call('/vulnerable/ranking', a)).rows[0].score, 12000);
  console.log('保存名の取得・ゲーム結果の保存・ランキング: OK（ブラウザ内XSS実行は別検証）');
  await call('/vulnerable/reset', a, {});
  await call('/vulnerable/profile', a, { name: '旧世代', generation: sa.generation }, 409);
  for (const token of [a, b]) for (const mode of ['vulnerable', 'fixed']) await call(`/${mode}/reset`, token, {});
  console.log('リセット・古い要求拒否: OK。検証に使った2領域を初期化しました。');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
