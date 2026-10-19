// このサーバー専用依存は通常版のブラウザには配信しない。
import postgres from 'npm:postgres@3.4.5';
import '../_shared/core.js';

const { seed, dispatch, fail, decodeBody } = (globalThis as any).WorkshopCore;
type Lab = { id: string; code: string; schema: string; readUrl: string; writeUrl: string };
const labs: Lab[] = JSON.parse(Deno.env.get('WORKSHOP_LABS') || '[]');
const origin = Deno.env.get('WORKSHOP_ORIGIN') || '';
const secret = Deno.env.get('WORKSHOP_SESSION_SECRET') || '';
const origins: string[] = JSON.parse(Deno.env.get('WORKSHOP_ORIGINS') || JSON.stringify([origin]));
if (!origins.length || secret.length < 32 || !labs.length) throw new Error('演習専用の環境変数を設定してください。');
for (const allowed of origins) {
  const frontend = new URL(allowed);
  if (frontend.origin !== allowed || (frontend.protocol !== 'https:' && allowed !== 'http://127.0.0.1:4173')) throw new Error('許可オリジンを確認してください。');
}
if (new Set(labs.map(l => l.code)).size !== labs.length || new Set(labs.map(l => l.schema)).size !== labs.length ||
    new Set(labs.map(l => l.id)).size !== labs.length) throw new Error('領域・参加コードは重複できません。');
for (const lab of labs) {
  if (!/^lab_[0-9]+$/.test(lab.schema) || !/^[a-z0-9-]{10,64}$/.test(lab.code)) throw new Error('演習領域の設定を確認してください。');
  // 管理者接続や、SET ROLEだけによる権限切替を禁止。
  if (!decodeURIComponent(new URL(lab.readUrl).username).startsWith(`${lab.schema}_reader`) ||
      !decodeURIComponent(new URL(lab.writeUrl).username).startsWith(`${lab.schema}_writer`)) throw new Error('ペア専用ログインロールが必要です。');
}
const encoder = new TextEncoder();
const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64 = (text: string) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0));
async function issue(lab: Lab, participant = 'legacy') {
  const sid = crypto.randomUUID();
  const exp = Date.now() + 8 * 3600000;
  const sql = client(lab.writeUrl);
  await sql`insert into ${sql(lab.schema)}.sessions (id, participant_id, expires_at) values (${sid}, ${participant}, ${new Date(exp)})`;
  const data = b64(encoder.encode(JSON.stringify({ lab: lab.id, participant, sid, exp })));
  return `${data}.${b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data))))}`;
}
async function authenticate(request: Request) {
  try {
    const parts = (request.headers.get('Authorization') || '').replace(/^Bearer /, '').split('.');
    if (parts.length !== 2 || !await crypto.subtle.verify('HMAC', key, unb64(parts[1]), encoder.encode(parts[0]))) throw new Error();
    const data = JSON.parse(new TextDecoder().decode(unb64(parts[0])));
    const lab = labs.find(l => l.id === data.lab);
    if (!lab || !Number.isFinite(data.exp) || data.exp < Date.now()) throw new Error();
    const participant = data.participant || 'legacy';
    if (participant !== 'legacy' && !/^[0-9a-f-]{36}$/.test(participant)) throw new Error();
    const sql = client(lab.writeUrl);
    const sid = data.sid || 'legacy-' + b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(parts.join('.')))));
    if (!data.sid) await sql`insert into ${sql(lab.schema)}.sessions (id, participant_id, expires_at) values (${sid}, ${participant}, ${new Date(data.exp)}) on conflict do nothing`;
    const [session] = await sql`select id from ${sql(lab.schema)}.sessions where id = ${sid} and participant_id = ${participant} and expires_at > now()`;
    if (!session) throw new Error();
    return { lab, participant, sid };
  } catch { fail(401, '参加コードで再入室してください。'); }
}
// 接続プールは資格情報ごとに独立。readerはSQLi専用、writerは固定クエリ専用。
const clients = new Map<string, ReturnType<typeof postgres>>();
function client(url: string) {
  if (!clients.has(url)) clients.set(url, postgres(url, { ssl: 'require', max: 1, prepare: false, idle_timeout: 10, connect_timeout: 10 }));
  return clients.get(url)!;
}
Deno.serve(async request => {
  const requestedOrigin = request.headers.get('Origin');
  const responseOrigin = requestedOrigin && origins.includes(requestedOrigin) ? requestedOrigin : origins[0];
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': responseOrigin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'authorization, content-type, priority',
    // DevToolsのCopy as fetchがcredentials: includeを付けても再送できるようにする。
    // 許可元は設定したオリジンのみ。認証には引き続きBearerセッションを使う。
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers });
  try {
    if (requestedOrigin && !origins.includes(requestedOrigin)) fail(403, '演習サイトから操作してください。');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*\/workshop/, '');
    // 読み込み段階でも上限を適用。
    let raw = '';
    if (request.body) {
      const reader = request.body.getReader(); const decoder = new TextDecoder(); let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
        if (size > 8192) { await reader.cancel(); fail(413, '入力が大きすぎます。'); } raw += decoder.decode(value, { stream: true }); }
      raw += decoder.decode();
    }
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch { fail(400, 'JSONを確認してください。'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'JSONオブジェクトが必要です。');
    body = decodeBody(body);
    if (request.method === 'POST' && path === '/session') {
      const lab = labs.find(l => l.code === body.code);
      if (!lab) fail(401, '参加コードが違います。');
      const writer = client(lab.writeUrl);
      if (body.action === 'login') fail(400, '名前と参加コードで新しく参加してください。');
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 40) fail(400, '参加者名を1〜40文字で入力してください。');
      const participant = crypto.randomUUID();
      const name = body.name.trim();
      await writer.begin(async sql => {
        const [user] = await sql`insert into ${sql(lab.schema)}.users (id, participant_id, name) values (${participant}, ${participant}, ${name}) returning profile_id`;
        for (const mode of ['vulnerable', 'fixed']) {
          const value = { ...seed(user.profile_id), userId: user.profile_id, name, participantName: name };
          await sql`insert into ${sql(lab.schema)}.state (participant_id, mode, value) values (${participant}, ${mode}, ${sql.json(value)})`;
        }
      });
      return reply(200, { token: await issue(lab, participant), lab: lab.id, participant });
    }
    let authenticated;
    try { authenticated = await authenticate(request); } catch (error) {
      if (request.method === 'POST' && path === '/logout' && (error as any).status === 401) return reply(200, { loggedOut: true });
      throw error;
    }
    const { lab, participant, sid } = authenticated!;
    if (request.method === 'POST' && path === '/logout') {
      const sql = client(lab.writeUrl);
      await sql`update ${sql(lab.schema)}.sessions set expires_at = to_timestamp(0) where id = ${sid} and participant_id = ${participant}`;
      return reply(200, { loggedOut: true });
    }
    const match = path.match(/^\/(vulnerable|fixed)(\/.*)$/);
    if (!match) fail(404, '演習モードを確認してください。');
    const [, mode, route] = match!;
    const writer = client(lab.writeUrl);
    const result = await writer.begin(async sql => {
      await sql`set local statement_timeout = '2000ms'`;
      await sql`set local lock_timeout = '2000ms'`;
      await sql`insert into ${sql(lab.schema)}.state (participant_id, mode, value) values (${participant}, ${mode}, ${sql.json(seed())}) on conflict do nothing`;
      // users行を先にロックし、別モード・別端末からの同時保存も直列化する。
      const [user] = await sql`select id, profile_id, games from ${sql(lab.schema)}.users where participant_id = ${participant} for update`;
      if (!user) fail(401, 'ユーザーが見つかりません。再登録してください。');
      const [row] = await sql`select value from ${sql(lab.schema)}.state where participant_id = ${participant} and mode = ${mode} for update`;
      const state = row.value;
      state.userId = user.profile_id;
      state.games = user.games;
      const result = await dispatch({ method: request.method, path: route, query: url.searchParams, body, mode, state,
        getProfile: async (id: number) => {
          const [target] = await sql`select u.games, s.value from ${sql(lab.schema)}.users u join ${sql(lab.schema)}.state s on s.participant_id = u.participant_id and s.mode = ${mode} where u.profile_id = ${id}`;
          return target ? { ...target.value, games: target.games } : null;
        },
        getLeaderboard: async () => {
          const rows = await sql`select u.profile_id, u.games, s.value->>'name' as name, s.value->>'published' as published from ${sql(lab.schema)}.users u join ${sql(lab.schema)}.state s on s.participant_id = u.participant_id and s.mode = ${mode}`;
          return rows.filter((row: any) => row.profile_id === user.profile_id ? state.published !== false : row.published !== 'false').flatMap((row: any) => (row.profile_id === user.profile_id ? state.games : row.games)
            .filter((p: any) => p.id !== 'seed-self' && p.id !== 'seed-guest')
            .map((p: any) => ({ ...p, userId: row.profile_id, name: row.profile_id === user.profile_id ? state.name : row.name })));
        },
        search: async (keyword: string, fixed: boolean) => {
          const registered = await sql`select u.profile_id, s.value from ${sql(lab.schema)}.users u join ${sql(lab.schema)}.state s on s.participant_id = u.participant_id where s.mode = ${mode}`;
          const directory = registered.flatMap((row: any) => {
            const profile = row.profile_id === user.profile_id ? state : row.value;
            if (row.profile_id !== user.profile_id && profile.published === false) return [];
            return [{ id: row.profile_id, name: profile.name, published: Number(profile.published !== false) }];
          });
          const reader = client(lab.readUrl);
          return await reader.begin('read only', async read => {
            await read`set local statement_timeout = '1000ms'`;
            // 公開表示名のスナップショットをバインドし、readerへのusers/state権限は追加しない。
            const source = `with users as (select (id + $2::int - 101)::text as id, name, published from "${lab.schema}".directory where published = 0 union all select id::text, name, published from jsonb_to_recordset($1::jsonb) as t(id int, name text, published int)) `;
            if (fixed) return await read.unsafe(source + 'select id, name, published from users where published = 1 and name like $3 limit 50', [JSON.stringify(directory), state.userId, '%' + keyword + '%'], { prepare: false });
            // 意図したSQLi。連結する入力は演習の検索語のみ。
            return await read.unsafe(source + `select id, name, published from users where published = 1 and name like '%${keyword}%' limit 50`, [JSON.stringify(directory), state.userId], { prepare: false });
          });
        } });
      await sql`update ${sql(lab.schema)}.users set games = ${sql.json(state.games)} where participant_id = ${participant}`;
      await sql`update ${sql(lab.schema)}.state set value = ${sql.json({ ...state, games: [] })} where participant_id = ${participant} and mode = ${mode}`;
      return result;
    });
    return reply(200, result);
  } catch (error) {
    const e = error as { status?: number; message: string; code?: string; name?: string };
    // 接続文字列・SQL・秘密値はレスポンスに含めず、障害識別子だけを返す。
    const diagnostic = /^[A-Za-z0-9_]{1,40}$/.test(e.code || '') ? e.code : 'INTERNAL_ERROR';
    return reply(e.status || 500, { error: e.status ? e.message : '教材サーバーでエラーが発生しました。講師にお知らせください。', ...(!e.status ? { diagnostic } : {}) });
  }
});
