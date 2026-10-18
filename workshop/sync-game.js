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
replace('<h2>麻雀 待ち当て</h2>', '<h2>麻雀 待ち当て</h2><p class="form-note">セキュリティ演習版 · 架空データ専用<br>麻雀をプレイしなくても、マイページ・ランキングから3問に取り組めます。</p>');
replace('<ol class="ranking-list" id="ranking-list"></ol>', '<ol class="ranking-list" id="ranking-list" hidden></ol><div id="game-ranking-host"></div>');
replace('<p class="form-note" id="mypage-email"></p>', '<p class="form-note" id="mypage-email"></p><p id="profile" class="form-note"></p>');
replace('<p class="entry-status" id="profile-status" aria-live="polite"></p>', '<p>保存前のプレビュー：<span id="preview"></span></p><p class="entry-status" id="profile-status" aria-live="polite"></p>');
replace('<button type="button" class="btn ghost" id="logout-btn">ログアウト</button>', `<section class="workshop-directory"><h3>登録者検索</h3><p class="form-note">掲載に同意した架空ユーザーの登録名を探します。ランキングのニックネームとは別です。</p>
      <form id="search-form" class="entry"><label for="keyword">登録名</label><div class="entry-row"><input id="keyword" maxlength="160" placeholder="公開"><button class="btn primary">検索</button></div></form><ul id="search-results"></ul><p id="search-evidence" class="form-note"></p></section>
      <button type="button" class="btn ghost" data-workshop-ranking>ランキングを見る</button>
      <details class="form-note"><summary>比較・リセット</summary><div class="workshop-toolbar"><label>比較モード <select id="mode"><option value="vulnerable">弱点版</option><option value="fixed">修正版</option></select></label><button type="button" id="reset" class="btn ghost small">このモードをリセット</button></div></details>
      <button type="button" class="btn ghost" id="logout-btn">退室</button>`);
// 本番用の認証フォームは配信物からも除外する。
html = html.replace(/  <div class="overlay" id="auth-overlay"[\s\S]*?(?=  <div class="overlay" id="mypage-overlay")/, '');
const overlays = `
  <div class="overlay workshop-top" id="entry"><div class="sheet">
    <div class="hero"><svg class="neko night hero-neko" aria-hidden="true"><use href="#neko-sit" /></svg><p class="bubble">いっしょに一局、どう？</p></div>
    <h2>麻雀 待ち当て</h2><p class="form-note">30秒で、いくつ見つけられるかな？<br>名前を登録して、自己ベストに挑戦しよう。</p>
    <form id="login" class="form"><label class="field">参加者名<input id="participant-name" maxlength="40" autocomplete="nickname" placeholder="ニックネーム" required></label><label class="field">参加コード<input id="code" autocomplete="off" required></label><button class="btn primary">参加する</button></form>
    <p class="form-note">招待された方だけが参加できるゲームです。名前にはニックネームを使ってください。</p></div></div>
  <div class="overlay" id="ranking-overlay" hidden><div class="sheet"><div class="sheet-head"><h2>ランキング 上位10件</h2><button id="ranking-close" class="btn ghost small">閉じる</button></div><p class="form-note">ゲーム終了時に記録した得点と、保存した表示名が反映されます。初期データがあるのでプレイせずに演習もできます。</p><div id="standalone-ranking-host"></div><button id="reload-ranking" class="btn ghost">再取得</button></div></div>
  <div id="frame-parking" hidden><iframe id="ranking-frame" title="ゲームのランキング・演習用表示領域" sandbox="allow-scripts" src="ranking-frame.html"></iframe></div>
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
