// 元のゲームを無変更で再利用するための同期コマンド。通常の起動時にビルドは不要。
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const publicDir = path.join(__dirname, 'public');
for (const file of ['main.js', 'mahjong-logic.js', 'tile-art.js', 'ranking.js', 'style.css']) {
  fs.copyFileSync(path.join(root, file), path.join(publicDir, file));
}
let html = fs.readFileSync(path.join(__dirname, 'game-template.html'), 'utf8');
function replace(from, to) {
  if (!html.includes(from)) throw new Error(`元ゲームの差分を確認してください: ${from.slice(0, 80)}`);
  html = html.replace(from, to);
}
// 外部フォントなしでも元のフォールバック書体で表示。通常版の認証接続は一切読み込まない。
html = html.replace(/^  <link[^\n]*https:\/\/fonts\.[^\n]*\n/gm, '');
replace('<title>麻雀 待ち当て</title>', '<title>麻雀 待ち当て｜セキュリティ演習版</title>');
replace('<link rel="stylesheet" href="style.css" />', '<link rel="stylesheet" href="style.css" />\n  <link rel="stylesheet" href="workshop.css" />');
replace('<ol class="ranking-list" id="ranking-list"></ol>', '<ol class="ranking-list" id="ranking-list" hidden></ol><div id="game-ranking-host"></div>');
replace('<p class="entry-status" id="profile-status" aria-live="polite"></p>', '<p>保存前のプレビュー：<span id="preview"></span></p><p class="entry-status" id="profile-status" aria-live="polite"></p>');
replace('<button type="button" class="btn ghost" id="logout-btn">ログアウト</button>', `<section class="workshop-directory"><h3>登録者検索</h3>
      <form id="search-form" class="entry"><div class="entry-row"><input aria-label="検索キーワード" id="keyword" maxlength="160" placeholder="名前で検索"><button class="btn primary">検索</button></div></form><ul id="search-results" tabindex="0" aria-label="検索結果"></ul><p id="search-evidence" class="form-note"></p></section>
      <button type="button" class="btn ghost" data-workshop-ranking>ランキングを見る</button>
      <button type="button" class="btn ghost" id="logout-btn">ログアウト</button>`);
// 本番用の認証フォームは配信物からも除外する。
html = html.replace(/  <div class="overlay" id="auth-overlay"[\s\S]*?(?=  <div class="overlay" id="mypage-overlay")/, '');
const overlays = `
  <div class="overlay workshop-top" id="entry"><div class="sheet">
    <div class="hero"><svg class="neko night hero-neko" aria-hidden="true"><use href="#neko-sit" /></svg><p class="bubble">麻雀って楽しいよね</p></div>
    <h2>麻雀 待ち当て</h2>
    <form id="login" class="form"><label class="field">参加者名<input id="participant-name" maxlength="40" autocomplete="nickname" placeholder="ニックネーム" required></label><label class="field">参加コード<input id="code" autocomplete="off" required></label><button class="btn primary">新しく参加する</button></form>
    </div></div>
  <div class="overlay" id="ranking-overlay" hidden><div class="sheet"><div class="sheet-head"><h2>ランキング 上位10件</h2><button id="ranking-close" class="btn ghost small">閉じる</button></div><p class="form-note">同じ参加グループのユーザーごとに最高点を1件掲載します。ログアウト後も記録は残ります。</p><div id="standalone-ranking-host"></div><button id="reload-ranking" class="btn ghost">再取得</button></div></div>
  <div id="frame-parking" hidden><iframe id="ranking-frame" title="ゲームのランキング・演習用表示領域" sandbox="allow-scripts allow-same-origin" src="ranking-frame.html"></iframe></div>
  <p id="notice" role="status" aria-live="polite"></p>
`;
const scripts = `  <script src="mahjong-logic.js"></script>
  <script src="tile-art.js"></script>
  <script src="config.js"></script>
  <script src="app.js"></script>
  <script src="ranking.js"></script>
  <script src="main.js"></script>`;
html = html.replace(/  <script src="mahjong-logic.js">[\s\S]*?(?=<\/body>)/, overlays + scripts + '\n');
fs.writeFileSync(path.join(publicDir, 'index.html'), html);
console.log('元ゲームの画面・ロジック・描画を演習版へ同期しました。通常版は変更していません。');
