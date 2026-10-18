// 元ゲームのOnline/Accountインターフェースを演習APIへ接続する。通常版の接続先は使わない。
(function () {
const $ = id => document.getElementById(id);
const L = window.MahjongLogic;
const base = window.WORKSHOP_API.replace(/\/$/, '');
const tokenKey = 'workshop-token:' + base;
let token = sessionStorage.getItem(tokenKey) || '';
let mode = 'vulnerable';
let status = null;
let account = null;
let activeRanking = null;
let revision = 0;
let playing = false;
let playContext = null;
let frameReady = false;
let noticeTimer;
let pendingRequests = 0;
const loading = document.createElement('div');
loading.id = 'api-loading';
loading.hidden = true;
loading.setAttribute('role', 'status');
loading.setAttribute('aria-live', 'polite');
const spinner = document.createElement('span');
spinner.className = 'api-spinner';
spinner.setAttribute('aria-hidden', 'true');
loading.append(spinner, document.createTextNode('通信中…'));
document.body.append(loading);
const listeners = [];
function notice(text) {
  $('notice').textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').textContent = ''; }, 9000);
}
async function api(path, body, context = { mode, token }) {
  pendingRequests++;
  loading.hidden = false;
  try {
  // Supabaseの入口で教材文字列が遮断されるため転送時だけBase64化する。暗号化・SQLi対策ではない。
  const wire = body === undefined ? undefined : { encoding: 'base64-json', data: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(body)))) };
  const response = await fetch(`${base}${path === '/session' ? path : '/' + context.mode + path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(context.token ? { Authorization: `Bearer ${context.token}` } : {}) },
    ...(wire === undefined ? {} : { body: JSON.stringify(wire) })
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '通信に失敗しました。');
  return value;
  } finally {
    pendingRequests--;
    loading.hidden = pendingRequests === 0;
  }
}
function run(fn) { return async event => { event?.preventDefault(); try { await fn(event); } catch (e) { notice(e.message); } }; }
function setAccount(name) {
  account = name === null ? null : { id: status.me, name };
  document.querySelectorAll('.account-slot').forEach(slot => {
    slot.replaceChildren(); slot.hidden = false;
    const label = document.createElement('span'); label.className = 'account-text'; label.textContent = account ? `${account.name} さん（演習版）` : '参加コードで入室してください';
    slot.append(label);
    for (const [text, action] of [['マイページ', openMyPage], ['ランキング', () => openRanking(false)]]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn ghost small'; button.textContent = text;
      button.addEventListener('click', run(action)); slot.append(button);
    }
  });
  listeners.forEach(fn => fn(account));
}
async function refresh() { status = await api('/status'); }
async function claim(challenge, evidence) {
  await api('/claims', { challenge, evidence, generation: status.generation });
  await refresh(); notice('課題クリア！');
}
async function openMyPage() {
  const rev = ++revision;
  $('mypage-overlay').hidden = false;
  $('profile').textContent = '読み込み中…';
  const profile = await api('/profiles/' + encodeURIComponent(status.me)); if (rev !== revision) return;
  $('mypage-email').textContent = `${profile.name} さん / プロフィールID ${profile.id}`;
  $('profile').textContent = profile.memo;
  $('profile-name').value = profile.name; $('preview').textContent = profile.name;
  const summary = L.summarizePlays(profile.history);
  $('my-best').textContent = `${summary.best.toLocaleString('ja-JP')}点`;
  $('my-count').textContent = `${summary.count}回`;
  $('my-average').textContent = `${summary.average.toLocaleString('ja-JP')}点`;
  $('my-accuracy').textContent = summary.accuracy === null ? '-' : `${summary.accuracy}%`;
  $('my-streak').textContent = summary.bestStreak;
  $('my-history').replaceChildren();
  for (const play of profile.history.slice(0,10)) {
    const li = document.createElement('li');
    li.textContent = `${new Date(play.at).toLocaleString('ja-JP')} / ${play.solved}/${play.answered}問 / ${play.score.toLocaleString('ja-JP')}点`;
    $('my-history').append(li);
  }
  $('my-history-empty').hidden = profile.history.length > 0;
  $('my-history-empty').textContent = 'まだ記録がありません。';
}
async function loadRanking() {
  if (!account) return;
  const rev = revision;
  const ranking = await api('/ranking'); if (rev !== revision) return;
  activeRanking = { ...ranking, mode };
  if (frameReady) $('ranking-frame').contentWindow.postMessage({ type: 'ranking', ...ranking }, '*');
}
async function openRanking(inGame) {
  revision++; activeRanking = null;
  const host = $(inGame ? 'game-ranking-host' : 'standalone-ranking-host');
  if ($('ranking-frame').parentElement !== host) {
    // iframeのDOM移動では閲覧コンテキストが再生成されるため、ready通知を待つ。
    frameReady = false;
    host.append($('ranking-frame'));
  }
  if (!inGame) $('ranking-overlay').hidden = false;
  await loadRanking();
}
function clearViews() {
  revision++; activeRanking = null;
  for (const id of ['mypage-overlay', 'ranking-overlay']) $(id).hidden = true;
  for (const id of ['profile', 'preview', 'search-evidence', 'profile-status']) $(id).textContent = '';
  $('profile-name').value = ''; $('keyword').value = ''; $('search-results').replaceChildren();
  $('ranking-frame').contentWindow.postMessage({ type: 'ranking', rows: [], fixed: true, ticket: null }, '*');
}
async function enter() {
  await refresh();
  const profile = await api('/profiles/' + encodeURIComponent(status.me));
  $('entry').hidden = true; setAccount(profile.name);
  // 元の開始画面から普通にゲームを開始できる。課題はプレイなしでも開ける。
}
function gameLock(value) {
  playing = value;
  for (const id of ['mode', 'reset', 'logout-btn']) $(id).disabled = value;
}
window.Account = { current: () => account, onChange: fn => listeners.push(fn) };
window.Online = {
  available: true,
  async topPlays() {
    if (!account) return [];
    const result = await api('/leaderboard');
    if (!$('end-overlay').hidden || !$('ranking-overlay').hidden) await loadRanking();
    return result.rows;
  },
  async savePlay(play) {
    const context = playContext;
    if (!context || context.token !== token || context.mode !== mode || context.generation !== status?.generation) throw new Error('演習状態が変わったため、このプレイは保存できません。');
    return (await api('/plays', { ...play, generation: context.generation }, context)).id;
  }
};
$('login').addEventListener('submit', run(async () => {
  const button = $('login').querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  try {
  const session = await api('/session', { code: $('code').value.trim(), name: $('participant-name').value.trim() });
  token = session.token; sessionStorage.setItem(tokenKey, token); $('code').value = '';
  await enter(); notice('登録しました。さっそく遊んでみましょう！');
  } finally { button.disabled = false; }
}));
$('profile-name').maxLength = 300;
$('profile-name').addEventListener('input', () => { $('preview').textContent = $('profile-name').value; });
$('profile-form').addEventListener('submit', run(async () => {
  const result = await api('/profile', { name: $('profile-name').value, generation: status.generation });
  setAccount(result.name); $('profile-status').textContent = '保存しました。ランキングで表示を確認できます。';
}));
$('search-form').addEventListener('submit', run(async () => {
  const rev = revision; $('search-results').replaceChildren(); $('search-evidence').textContent = '';
  const result = await api('/directory', { q: $('keyword').value }); if (rev !== revision) return;
  for (const row of result.rows) { const li = document.createElement('li'); li.textContent = row.name; $('search-results').append(li); }
  $('search-evidence').textContent = result.evidence ? `証拠コード：${result.evidence}` : `${result.rows.length}件見つかりました。`;
}));
$('mypage-close').addEventListener('click', () => { revision++; $('mypage-overlay').hidden = true; });
$('ranking-close').addEventListener('click', run(async () => { $('ranking-overlay').hidden = true; if (!$('end-overlay').hidden) await openRanking(true); }));
$('reload-ranking').addEventListener('click', run(loadRanking));
 document.querySelectorAll('[data-workshop-ranking]').forEach(button => button.addEventListener('click', run(() => openRanking(false))));
$('mode').addEventListener('change', run(async () => {
  if (playing) return;
  mode = $('mode').value; clearViews(); await refresh();
  setAccount((await api('/profiles/' + encodeURIComponent(status.me))).name);
  if (!$('end-overlay').hidden) await openRanking(true);
  notice('比較モードを切り替えました。同じ入力をもう一度試してください。');
}));
$('reset').addEventListener('click', run(async () => {
  if (playing || !confirm('このモードのプレイ記録・名前・成功状況を初期化しますか？')) return;
  clearViews(); await api('/reset', {}); await refresh(); setAccount((await api('/profiles/' + encodeURIComponent(status.me))).name);
  if (!$('end-overlay').hidden) await openRanking(true);
  notice('現在の演習領域を初期化しました。');
}));
$('logout-btn').addEventListener('click', () => {
  if (playing) return;
  token = ''; sessionStorage.removeItem(tokenKey); clearViews(); setAccount(null);
  $('entry').hidden = false;
});
for (const id of ['start-btn', 'restart-btn']) $(id).addEventListener('click', () => {
  playContext = { mode, token, generation: status?.generation }; gameLock(true);
});
new MutationObserver(() => {
  if (!$('end-overlay').hidden) { gameLock(false); run(() => openRanking(true))(); }
}).observe($('end-overlay'), { attributes: true, attributeFilter: ['hidden'] });
window.addEventListener('message', run(async event => {
  if (event.source !== $('ranking-frame').contentWindow || event.origin !== 'null') return;
  if (event.data?.type === 'ranking-ready') {
    frameReady = true;
    if (activeRanking) $('ranking-frame').contentWindow.postMessage({ type: 'ranking', ...activeRanking }, '*');
  }
  if (event.data?.type === 'xss-proof' && activeRanking && activeRanking.mode === mode && !activeRanking.fixed &&
      event.data.ticket === activeRanking.ticket && activeRanking.generation === status?.generation) {
    activeRanking = null; await claim('xss', event.data.ticket);
  }
}));
if (token) enter().catch(() => { token = ''; sessionStorage.removeItem(tokenKey); notice('参加コードで再入室してください。'); });
})();
