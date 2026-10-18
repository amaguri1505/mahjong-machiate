# GameMVP — AI向け開発ガイド

シンプルな2Dブラウザゲーム（Canvas）。プレイヤーを操作してコインを集め、30秒間のスコアを競う。

## 絶対に守る制約
- **ビルド不要を維持する**：`index.html` をブラウザで直接開く（`file://`）だけで動くこと。
  - そのため ES Modules（`import`/`export`）、バンドラ、トランスパイラは使わない。
  - 外部ライブラリやnpm依存も追加しない（テストも Node 標準の `node:test` を使う）。
- スクリプトは `index.html` の `<script>` で読み込む。順番は `game-logic.js` → `main.js`。

## ファイル構成
- `game-logic.js` — DOMや描画に依存しない純粋なロジック（移動・当たり判定・スコア・コイン補充・定数）。
  ブラウザでは `window.GameLogic`、Nodeでは `require()` で読み込める形（IIFE + `module.exports`）。
- `main.js` — DOM・Canvas描画・入力・ゲームループ・タイマー。ロジックは `GameLogic` を呼ぶだけにする。
- `game-logic.test.js` — `game-logic.js` のテスト。
- `index.html` / `style.css` — マークアップと見た目。

## 開発ルール
- 新しいゲームルール（敵、アイテム、得点計算など）は、まず `game-logic.js` に純粋関数として書き、テストを追加する。
  `main.js` には描画とDOMの処理だけを置く。
- 関数は引数を書き換えず、新しい値を返す（例：`movePlayer` は新しい座標を返す）。
- 乱数を使う関数は `rand = Math.random` 引数で差し替えられるようにし、テストでは固定値を渡す。
- 調整用の数値はファイル先頭の定数にまとめる。
- コメントやUIの文言は日本語。

## 確認方法（変更したら必ず実行）
1. `npm test`（= `node --test`）がすべて通ること。
2. ブラウザで `index.html` を開き、移動・コイン取得・時間切れ・リスタートが動くこと。
   ヘッドレスで見た目だけ確認する場合：
   `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --virtual-time-budget=2000 --window-size=900,650 --screenshot=<出力先>.png "file://$PWD/index.html"`

## 作業の進め方
- 1機能につき1ブランチ（`feature/<名前>`）。`main` へ直接コミットしない。
- 依頼は小さく区切る。大きな変更は先に計画を出して合意を取る。
