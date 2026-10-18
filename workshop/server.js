// Node 24以上。依存追加なし。演習だけを127.0.0.1で配信する。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { participantCode } = require('./participant-code');
const { DatabaseSync } = require('node:sqlite');
const { seed, dispatch, fail, decodeBody } = require('./supabase/functions/_shared/core.js');

function createWorkshop(options = {}) {
  const project = require('./project.json');
  const remoteOrigin = options.supabase ? `https://${project.projectRef}.supabase.co` : '';
  if (options.supabase) {
    const production = fs.readFileSync(path.join(__dirname, '..', 'online.js'), 'utf8');
    if (!/^[a-z]{20}$/.test(project.projectRef) || production.includes(remoteOrigin)) throw new Error('演習専用プロジェクトの設定を確認してください。');
  }
  const labs = new Map();
  const sessions = new Map();
  const users = new Map();
  let nextProfileId = 101;
  const codes = options.supabase ? [] : options.codes || [participantCode(0), participantCode(1)];
  codes.forEach((code, i) => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE directory (id INTEGER PRIMARY KEY, name TEXT, published INTEGER);
      INSERT INTO directory VALUES (103,'ゲスト猫',1),(102,'ライバル猫',0),(104,'森の猫',0);
      PRAGMA query_only = ON;`);
    labs.set(code, { id: i + 1, db, states: { vulnerable: seed(), fixed: seed() }, tail: Promise.resolve() });
  });
  async function handle(req, res) {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" };
    function reply(status, value, type = 'application/json; charset=utf-8') {
      res.writeHead(status, { ...headers, 'Content-Type': type });
      res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
    }
    if (remoteOrigin) headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace("connect-src 'self'", `connect-src 'self' ${remoteOrigin}`);
    try {
      // DNS rebindingや他オリジンのフォームからの操作も拒否。
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost) fail(403, '127.0.0.1のURLを使用してください。');
      if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) fail(403, '別オリジンからは操作できません。');
      const url = new URL(req.url, `http://${expectedHost}`);
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') fail(405, 'GETのみです。');
        const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css', '/workshop.css': 'workshop.css',
          '/main.js': 'main.js', '/mahjong-logic.js': 'mahjong-logic.js', '/tile-art.js': 'tile-art.js', '/ranking.js': 'ranking.js',
          '/config.js': 'config.js', '/ranking-frame.html': 'ranking-frame.html', '/ranking-frame.js': 'ranking-frame.js' };
        const file = files[url.pathname];
        if (!file) fail(404, 'ページが見つかりません。');
        if (file === 'config.js' && remoteOrigin) {
          reply(200, `window.WORKSHOP_API = ${JSON.stringify(remoteOrigin + '/functions/v1/workshop')};`, 'text/javascript; charset=utf-8');
          return;
        }
        if (file === 'ranking-frame.html') headers['Content-Security-Policy'] = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";
        reply(200, fs.readFileSync(path.join(__dirname, 'public', file)), file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
        return;
      }
      if (remoteOrigin) fail(404, 'SupabaseモードではローカルAPIを使用しません。');
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 8192) fail(413, '入力が大きすぎます。');
      }
      let body;
      try { body = raw ? JSON.parse(raw) : {}; } catch { fail(400, 'JSONを確認してください。'); }
      if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'JSONオブジェクトが必要です。');
      body = decodeBody(body);
      if (req.method === 'POST' && url.pathname === '/api/session') {
        let lab = labs.get(body.code);
        if (!lab) fail(401, '参加コードが違います。');
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 40) fail(400, '参加者名を1〜40文字で入力してください。');
        const name = body.name.trim();
        const userId = nextProfileId++;
        users.set(userId, { id: userId, name, labId: lab.id });
        lab = { ...lab, userId, states: { vulnerable: { ...seed(userId), userId, name, participantName: name }, fixed: { ...seed(userId), userId, name, participantName: name } }, tail: Promise.resolve() };
        const token = randomBytes(32).toString('hex');
        sessions.set(token, { lab, expires: Date.now() + 8 * 3600000 });
        reply(200, { token, lab: lab.id, participant: userId }); return;
      }
      const session = sessions.get((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (!session || session.expires < Date.now()) fail(401, '参加コードで入室してください。');
      const match = url.pathname.match(/^\/api\/(vulnerable|fixed)(\/.*)$/);
      if (!match) fail(404, '演習モードを確認してください。');
      const [, mode, route] = match;
      const lab = session.lab;
      // 同じペアの更新とリセットを直列化。別ペアのDBにはアクセスしない。
      const work = lab.tail.then(async () => {
        const state = structuredClone(lab.states[mode]);
        const result = await dispatch({ method: req.method, path: route, query: url.searchParams, body, mode, state,
          search: async (keyword, fixed) => {
            // 教材の唯一のSQLi。sqliteの実SQLエンジンで実行する。
            // 本人の保存済みプロフィールと架空ユーザーを、読み取り専用SQLの中でまとめる。
            // 本人の名前・公開設定は常にバインド。意図的に連結するのは弱点版の検索語だけ。
            const source = 'WITH users AS (SELECT ? AS id, ? AS name, ? AS published UNION ALL SELECT id + ? - 101, name, published FROM directory) ';
            const sql = source + (fixed ? 'SELECT id, name, published FROM users WHERE published = 1 AND name LIKE ? LIMIT 10'
              : `SELECT id, name, published FROM users WHERE published = 1 AND name LIKE '%${keyword}%' LIMIT 10`);
            const args = [state.userId, state.name, Number(state.published), state.userId];
            return fixed ? lab.db.prepare(sql).all(...args, `%${keyword}%`) : lab.db.prepare(sql).all(...args);
          } });
        lab.states[mode] = state;
        return result;
      });
      lab.tail = work.catch(() => {});
      reply(200, await work);
    } catch (e) { reply(e.status || 500, { error: e.status ? e.message : '教材サーバーでエラーが発生しました。' }); }
  }
  const server = http.createServer(handle);
  return { server, codes, close: () => { server.close(); for (const lab of labs.values()) lab.db.close(); } };
}
if (require.main === module) {
  const remote = process.argv.includes('--supabase');
  const workshop = createWorkshop({ supabase: remote });
  workshop.server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => {
    console.log(`演習版: http://127.0.0.1:${workshop.server.address().port}`);
    workshop.codes.forEach((code, i) => console.log(`ペア${i + 1}の参加コード: ${code}`));
    console.log(remote ? 'API接続先: 演習専用Supabase。参加コードは.setup内のparticipants.txtを使用します。' : 'データはメモリ内のみ。サーバー再起動で全領域を初期化します。');
  });
}
module.exports = { createWorkshop };
