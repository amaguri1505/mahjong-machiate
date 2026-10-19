// Node 24以上。依存追加なし。演習だけを127.0.0.1で配信する。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
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
  const databasePath = options.databasePath || (options.memory || options.supabase ? ':memory:' : path.join(__dirname, 'game.sqlite'));
  const storage = new DatabaseSync(databasePath);
  storage.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER NOT NULL,
      name TEXT NOT NULL, states TEXT NOT NULL, games TEXT NOT NULL DEFAULT '[]');
    INSERT OR IGNORE INTO sqlite_sequence(name, seq) SELECT 'accounts', 100 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'accounts');
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  // 旧ログイン方式のDBも、ID・成績・セッションを保持して移行する。
  if (storage.prepare('PRAGMA table_info(accounts)').all().some(column => column.name === 'login_id')) {
    storage.exec('PRAGMA foreign_keys = OFF');
    try { storage.exec(`BEGIN IMMEDIATE;
      CREATE TABLE participants_new (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER NOT NULL,
        name TEXT NOT NULL, states TEXT NOT NULL, games TEXT NOT NULL DEFAULT '[]');
      INSERT INTO participants_new SELECT id, lab_id, name, states, games FROM accounts;
      INSERT INTO sqlite_sequence(name, seq) SELECT 'participants_new', seq FROM sqlite_sequence WHERE name = 'accounts' AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'participants_new');
      UPDATE sqlite_sequence SET seq = MAX(seq, (SELECT seq FROM sqlite_sequence WHERE name = 'accounts')) WHERE name = 'participants_new';
      DROP TABLE accounts;
      ALTER TABLE participants_new RENAME TO accounts;
      COMMIT;`);
    } catch (error) { storage.exec('ROLLBACK'); throw error; }
    finally { storage.exec('PRAGMA foreign_keys = ON'); }
  }
  if (databasePath !== ':memory:') fs.chmodSync(databasePath, 0o600);
  const savedCodes = storage.prepare("SELECT value FROM settings WHERE key = 'codes'").get();
  const codes = options.supabase ? [] : options.codes || (savedCodes ? JSON.parse(savedCodes.value) : [participantCode(0), participantCode(1)]);
  if (!savedCodes && !options.supabase) storage.prepare("INSERT INTO settings VALUES ('codes', ?)").run(JSON.stringify(codes));
  const digest = token => createHash('sha256').update(token).digest('hex');
  let tail = Promise.resolve();
  codes.forEach((code, i) => {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE directory (id INTEGER PRIMARY KEY, name TEXT, published INTEGER);
      INSERT INTO directory VALUES (103,'ゲスト猫',1),(102,'ライバル猫',0),(104,'森の猫',0);
      PRAGMA query_only = ON;`);
    labs.set(code, { id: i + 1, db });
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
        if (body.action === 'login') fail(400, '再ログインはできません。名前と参加コードで新しく参加してください。');
        if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 40) fail(400, '参加者名を1〜40文字で入力してください。');
        const name = body.name.trim();
        let user;
        // PRIMARY KEYとAUTOINCREMENTで、既存・削除済みIDを再利用しない。
        storage.exec('BEGIN IMMEDIATE');
        try {
          const result = storage.prepare('INSERT INTO accounts (lab_id, name, states) VALUES (?, ?, ?)').run(lab.id, name, '{}');
          const userId = Number(result.lastInsertRowid);
          const states = Object.fromEntries(['vulnerable', 'fixed'].map(mode => [mode, { ...seed(userId), userId, name, participantName: name }]));
          storage.prepare('UPDATE accounts SET states = ? WHERE id = ?').run(JSON.stringify(states), userId);
          storage.exec('COMMIT');
          user = { id: userId };
        } catch (error) { storage.exec('ROLLBACK'); throw error; }
        const token = randomBytes(32).toString('hex');
        storage.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), user.id, Date.now() + 8 * 3600000);
        reply(200, { token, lab: lab.id, participant: user.id }); return;
      }
      const tokenHash = digest((req.headers.authorization || '').replace(/^Bearer /, ''));
      const session = storage.prepare('SELECT * FROM sessions WHERE token = ?').get(tokenHash);
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        storage.prepare('DELETE FROM sessions WHERE token = ?').run(tokenHash);
        reply(200, { loggedOut: true }); return;
      }
      if (!session || session.expires < Date.now()) fail(401, '名前と参加コードで参加してください。');
      const match = url.pathname.match(/^\/api\/(vulnerable|fixed)(\/.*)$/);
      if (!match) fail(404, '演習モードを確認してください。');
      const [, mode, route] = match;
      // 全セッションの読み込み・更新を直列化し、同じユーザーの同時プレイも落とさない。
      const work = tail.then(async () => {
        const user = storage.prepare('SELECT * FROM accounts WHERE id = ?').get(session.user_id);
        if (!user) fail(401, '名前と参加コードで参加してください。');
        const lab = [...labs.values()].find(l => l.id === user.lab_id);
        const states = JSON.parse(user.states);
        const state = states[mode];
        state.games = JSON.parse(user.games);
        const result = await dispatch({ method: req.method, path: route, query: url.searchParams, body, mode, state,
          getProfile: async id => {
            const target = storage.prepare('SELECT states, games FROM accounts WHERE id = ? AND lab_id = ?').get(id, user.lab_id);
            return target ? { ...JSON.parse(target.states)[mode], games: JSON.parse(target.games) } : null;
          },
          getLeaderboard: async () => storage.prepare('SELECT id, states, games FROM accounts WHERE lab_id = ?').all(user.lab_id).flatMap(row => {
            const profile = row.id === user.id ? state : JSON.parse(row.states)[mode];
            if (profile.published === false) return [];
            const games = row.id === user.id ? state.games : JSON.parse(row.games);
            return games.filter(p => p.id !== 'seed-self' && p.id !== 'seed-guest').map(p => ({ ...p, userId: row.id, name: profile.name }));
          }),
          search: async (keyword, fixed) => {
            // 実参加者の公開表示名だけを渡す。セッションや非公開プロフィールは検索DBに置かない。
            const directory = storage.prepare('SELECT id, states FROM accounts WHERE lab_id = ?').all(user.lab_id).flatMap(row => {
              const profile = row.id === user.id ? state : JSON.parse(row.states)[mode];
              if (row.id !== user.id && profile.published === false) return [];
              return [{ id: row.id, name: profile.name, published: Number(profile.published !== false) }];
            });
            // 非掲載の架空名はSQLi演習だけに残し、通常検索には出さない。
            const source = "WITH users AS (SELECT id + ? - 101 AS id, name, published FROM directory WHERE published = 0 UNION ALL SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.published') FROM json_each(?)) ";
            const sql = source + (fixed ? 'SELECT id, name, published FROM users WHERE published = 1 AND name LIKE ? LIMIT 50'
              : `SELECT id, name, published FROM users WHERE published = 1 AND name LIKE '%${keyword}%' LIMIT 50`);
            const args = [state.userId, JSON.stringify(directory)];
            return fixed ? lab.db.prepare(sql).all(...args, `%${keyword}%`) : lab.db.prepare(sql).all(...args);
          } });
        states[mode] = { ...state, games: [] };
        storage.prepare('UPDATE accounts SET states = ?, games = ? WHERE id = ?').run(JSON.stringify(states), JSON.stringify(state.games), user.id);
        return result;
      });
      tail = work.catch(() => {});
      reply(200, await work);
    } catch (e) { reply(e.status || 500, { error: e.status ? e.message : '教材サーバーでエラーが発生しました。' }); }
  }
  const server = http.createServer(handle);
  return { server, codes, close: () => { server.close(); for (const lab of labs.values()) lab.db.close(); storage.close(); } };
}
if (require.main === module) {
  const remote = process.argv.includes('--supabase');
  const workshop = createWorkshop({ supabase: remote, databasePath: remote ? undefined : path.join(__dirname, 'game.sqlite') });
  workshop.server.listen(Number(process.env.PORT || (remote ? 4173 : 4176)), '127.0.0.1', () => {
    console.log(`演習版: http://127.0.0.1:${workshop.server.address().port}`);
    workshop.codes.forEach((code, i) => console.log(`ペア${i + 1}の参加コード: ${code}`));
    console.log(remote ? 'API接続先: 演習専用Supabase。参加コードは.setup内のparticipants.txtを使用します。' : 'ユーザーと成績はworkshop/game.sqliteに保存します。再起動しても維持します。');
  });
}
module.exports = { createWorkshop };
