// 通常版とは独立した教材API。NodeとSupabase Edge Functionで共有する。
(function (root) {
  const uuid = () => crypto.randomUUID();
  function seed(userId = 101) {
    return { generation: uuid(), name: 'あなた', published: true, solved: [], idorSeen: false,
      games: [],
      sqlSeen: false, xssTicket: null, secret: `NOTE-${uuid()}`, proof: `NAME-${uuid()}` };
  }
  function fail(status, message) { throw Object.assign(new Error(message), { status }); }
  // 教材の攻撃文字列をクラウドの入口で遮断されずに届ける転送形式。
  // エンコードは防御ではない。復号後の値に対して修正版の認可・パラメータ化を適用する。
  function decodeBody(body) {
    if (body?.encoding !== 'base64-json') return body;
    try {
      if (typeof body.data !== 'string' || body.data.length > 7000) fail(400, '本文の形式が不正です。');
      const bytes = Uint8Array.from(atob(body.data), c => c.charCodeAt(0));
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'JSONオブジェクトが必要です。');
      return value;
    } catch { fail(400, '転送本文を復号できません。'); }
  }
  function requireText(value, max = 200) {
    if (typeof value !== 'string' || value.length > max) fail(400, '入力の形式・長さを確認してください。');
    return value;
  }
  function solved(state, id) { if (!state.solved.includes(id)) state.solved.push(id); }
  // bodyのlab_idやuser_idは認証主体の決定に使用しない。
  async function dispatch({ method, path, query, body, state, search, getProfile, getLeaderboard, mode }) {
    const fixed = mode === 'fixed';
    // 旧版の教材状態を読み込んだ場合も、ゲーム記録を追加できる。
    state.games = (state.games || []).filter(p => p.id !== 'seed-self' && p.id !== 'seed-guest');
    state.published ??= true;
    const me = state.userId;
    if (!me) fail(500, 'ユーザーIDがありません。');

    const leaderboard = async () => {
      const seen = new Set();
      const games = getLeaderboard ? await getLeaderboard() : state.games;
      return [...games].filter(p => p.userId !== me || state.published !== false).sort((a, b) => b.score - a.score || a.at - b.at)
        .filter(p => {
          if (seen.has(p.userId)) return false;
          seen.add(p.userId);
          return true;
        }).slice(0, 10)
        .map(p => ({ ...p, name: p.userId === me ? state.name : (p.name || 'ゲスト猫') }));
    };
    if (method === 'GET' && path === '/status') return { me, mode, generation: state.generation, solved: state.solved };
    if (method === 'POST' && path === '/reset') {
      Object.assign(state, seed(me), { userId: me, games: state.games }, state.participantName ? { name: state.participantName } : {});

      return { reset: true };
    }
    if (method === 'GET' && /^\/profiles\/[a-zA-Z0-9-]+$/.test(path)) {
      const requested = path.split('/').pop();
      const id = /^\d+$/.test(requested) ? Number(requested) : NaN;
      if (!Number.isSafeInteger(id) || (fixed && id !== me)) fail(404, 'マイページが見つかりません。');
      const profile = id === me ? state : await getProfile?.(id);
      if (!profile) fail(404, 'マイページが見つかりません。');
      if (id !== me) state.idorSeen = true;
      const history = (profile.games || []).filter(p => p.userId === id && p.id !== 'seed-self' && p.id !== 'seed-guest').sort((a,b) => b.at - a.at);
      return { id, name: profile.name, published: profile.published !== false, best: Math.max(0, ...history.map(p => p.score)),
        plays: history.length, history, memo: profile.memo || '明日は練習しよう。',
        ...(id !== me ? { evidence: state.secret } : {}) };
    }
    if (method === 'POST' && path === '/plays') {
      if (body.generation !== state.generation) fail(409, 'リセット後のプレイは保存できません。');
      const { score, solved, answered, bestStreak } = body;
      if (![score, solved, answered, bestStreak].every(Number.isInteger) || solved < 0 || answered < solved || answered > 300 ||
          bestStreak < 0 || bestStreak > solved || score < 0 || score > solved * 128000) fail(400, 'プレイ記録の値が不正です。');
      const play = { id: uuid(), userId: me, score, solved, answered, bestStreak, at: Date.now() };
      state.games.push(play);
      return { id: play.id };
    }
    if (method === 'GET' && path === '/leaderboard') return { rows: await leaderboard() };
    if (method === 'POST' && path === '/profile') {
      if (body.generation !== state.generation) fail(409, 'リセット後の画面を開き直してください。');
      if (body.published !== undefined && typeof body.published !== 'boolean') fail(400, '公開設定はtrueまたはfalseで指定してください。');
      state.name = requireText(body.name, 300).trim() || 'あなた';
      if (body.published !== undefined) state.published = body.published;
      state.xssTicket = null;
      return { name: state.name, published: state.published };
    }
    if (['GET', 'POST'].includes(method) && path === '/directory') {
      const keyword = requireText((method === 'POST' ? body.q : query.get('q')) || '', 160);
      let rows;
      try { rows = await search(keyword, fixed); }
      catch { fail(400, '検索SQLを実行できませんでした。検索語の引用符と構文を確認してください。'); }
      const found = rows.some(row => Number(row.id) === me + 1 && row.published === 0);
      if (found && !fixed) state.sqlSeen = true;
      return { rows, ...(found && !fixed ? { evidence: state.proof } : {}) };
    }
    if (method === 'GET' && path === '/ranking') {
      state.xssTicket = uuid();
      // 未プレイでもXSS演習を試せる表示用データ。成績・履歴には保存しない。
      const rows = await leaderboard();
      return { rows: rows.map(p => ({ ...p, allowHtml: !fixed })),
        preview: state.published === false || rows.some(p => p.userId === me) ? null : { userId: me, name: state.name, sample: true, allowHtml: !fixed },
        ticket: state.xssTicket, fixed, generation: state.generation };
    }
    if (method === 'POST' && path === '/claims') {
      if (body.generation !== state.generation) fail(409, 'リセット後の画面を開き直してください。');
      if (fixed) fail(400, '修正版では攻略成功を登録しません。');
      if (body.challenge === 'idor' && state.idorSeen && body.evidence === state.secret) solved(state, 'idor');
      else if (body.challenge === 'sqli' && state.sqlSeen && body.evidence === state.proof) solved(state, 'sqli');
      else if (body.challenge === 'xss' && state.xssTicket && body.evidence === state.xssTicket) {
        solved(state, 'xss'); state.xssTicket = null;
      } else fail(400, '証拠が一致しません。対象の画面・レスポンスを確認してください。');
      return { solved: state.solved };
    }
    fail(404, 'APIが見つかりません。');
  }
  root.WorkshopCore = { seed, dispatch, fail, decodeBody };
  if (typeof module !== 'undefined') module.exports = root.WorkshopCore;
})(globalThis);
