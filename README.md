# 麻雀 待ち当て

テンパイした手牌の待ちを、30秒の持ち時間でできるだけ多く当てるブラウザゲーム。

## 遊び方

`index.html` をブラウザで開くだけで動作する（ビルド不要）。スマホのタップ操作にも対応。

- 13枚の手牌が出題されるので、待ち牌をすべて選んで「決定」（Enterキーでも可）
- 過不足なく選べたら正解。高目でツモ和了したときの点数が入る（子・東場南家・ドラなし）
- 6問連続で正解すると清一色の問題に変わる。間違えると連続正解が0に戻り、普通の手に戻る
- 答えるとすぐ次の問題へ。前の問題の待ち・役・点数は決定ボタンの下に表示される
- 持ち時間は30秒。終了後に全問の振り返りが見られる
- ログインして遊ぶと、記録が自動でランキングとマイページに残る（ログインなしでも遊べる）

## Supabase の準備（ログイン機能）

1. Supabase の管理画面 → SQL Editor に `supabase/schema.sql` を貼り付けて Run
2. Authentication → URL Configuration の Site URL / Redirect URLs に、公開したページのURLを入れる
   （確認メールやパスワード再設定メールのリンクの戻り先になる）

## ファイル構成

- `index.html` — マークアップ
- `style.css` — 見た目
- `mahjong-logic.js` — 待ち判定・点数計算・出題のロジック
- `tile-art.js` — 筒子・索子の絵柄(SVG)
- `online.js` — Supabase との通信（ログイン・記録）
- `ranking.js` — ランキングの保存（Supabase / Artifact の共有DB / 端末内）
- `account.js` — ログイン画面・マイページ
- `supabase/schema.sql` — Supabase の表とアクセスルール
- `main.js` — 画面描画・入力・タイマー
- `mahjong-logic.test.js` — ロジックのテスト

## テスト

```
npm test
```

Node.js 標準のテストランナー(`node --test`)を使うため、依存パッケージのインストールは不要。
