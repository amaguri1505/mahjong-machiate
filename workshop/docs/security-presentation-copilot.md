# SQLインジェクション・XSS・IDOR：プレゼン作成用Copilotプロンプト

以下の「Copilotへの指示」から末尾までを、プレゼン作成側のCopilotへ渡してください。想定はWeb開発の基礎を知る人向け、約20〜25分、全12枚です。コードは2026年10月20日時点のこのリポジトリを確認した内容です。再現結果は期待値であり、この資料の作成時にブラウザ実演を実施したという意味ではありません。

---

## Copilotへの指示

麻雀ゲームのセキュリティ演習アプリを題材に、日本語のプレゼンを全12枚で作成してください。目的はSQLインジェクション、XSS、IDORについて「再現する操作」「原因となる実装」「防止する実装」を対応づけて理解することです。

- 各スライドにタイトル、短い本文、コードまたは操作手順、発表者ノートを付けてください。
- 下記のスライド順を守り、コードと入力文字列の引用符・記号を変更しないでください。コードは画像化せず、編集できる等幅テキストにしてください。
- 本文は要点を3〜5項目程度に絞り、詳しい操作・補足・出典を発表者ノートへ入れてください。
- 脆弱な行と修正した行を色で区別してください。図を使うなら、入力・サーバー・DB・ブラウザ間のデータの流れを示してください。
- 実画面のスクリーンショットは提供していません。画面や実行結果の画像を捏造しないでください。
- 対象は許可された教材環境とデモ用ユーザーです。
- 現在の画面は弱点版APIを使用します。「演習課題」「修正版へ切り替えるボタン」「証拠コード提出画面」があるという説明を追加しないでください。修正版はAPIと実装の比較で紹介します。
- サーバーコードの抜粋・簡略例には、その旨と出典パスをノートへ記載してください。付録はスライド枚数に加えず、関連するノートへ収録してください。

## スライド1：麻雀ゲームで学ぶ3つの脆弱性

**本文**

- SQLインジェクション：検索入力がSQLの条件を変える
- XSS：保存した表示名がブラウザでJavaScriptとして実行される
- IDOR：対象IDを変えると他人のプロフィールが取得できる

**発表者ノート**

「今回は、同じゲームの検索・ランキング・マイページを使います。各機能で何を入力すると何が起こるかを確認し、その結果を生むコードと修正を見比べます。」

## スライド2：デモ環境と観察ポイント

**本文**

1. Node.js 24以上で `node workshop/server.js` を実行
2. `http://127.0.0.1:4176` を開く
3. 起動時に表示された同じ参加コードで、デモ用ユーザーA・Bを別のブラウザプロファイルから登録
4. マイページのプロフィールIDをA・Bそれぞれ控える
5. 開発者ツールのNetworkでFetch/XHRを観察

**発表者ノート**

「登録名は『デモA』『デモB』などにします。再登録すると新しいIDになるため、IDを101・102や自分のID+1に決め打ちしません。操作はAのブラウザから進め、BはIDORの対象として用意します。SQLiとXSSはゲームをプレイせずに試せます。現行の画面は弱点版です。修正版の確認は付録のAPI操作を使います。トークンを含む通信コードはスライドや配布資料に貼り付けません。」

出典：`workshop/server.js`、`workshop/public/app.js`、`workshop/public/index.html`

## スライド3：SQLインジェクションの再現

**本文**

1. Aのマイページで「登録者検索」に `デモ` と入力して検索
2. 公開状態のデモ用登録者が検索されることを確認
3. 次の文字列へ変更して検索（末尾に半角スペース）

```text
' OR 1=1 -- 
```

4. 非掲載の架空名「架空登録者・青葉」「架空登録者・紅葉」が結果に含まれることを確認
5. Networkの `POST …/vulnerable/directory` のJSONレスポンスを確認

**発表者ノート**

「普段は公開されている名前だけが返ります。入力後は非掲載の架空名も返ります。結果の総件数は登録状況によって変わるので、3件と固定しません。レスポンスには演習用のevidenceが付く場合がありますが、今回の実演では非掲載データの取得を観察します。SQLiで読める架空名と、IDORで取得する実ユーザーのプロフィールは別のデータです。」

## スライド4：SQLインジェクションが起こる実装

**本文とコード：実装から検索部分を抜粋**

```js
const sql = source +
  `SELECT id, name, published FROM users
   WHERE published = 1
   AND name LIKE '%${keyword}%' LIMIT 50`;
```

入力後の検索部分：

```sql
SELECT id, name, published FROM users
WHERE published = 1 AND name LIKE '%' OR 1=1 -- %' LIMIT 50
```

- 引用符で検索文字列を閉じ、入力がSQLの構文になる
- `OR 1=1` が条件を成立させる
- `-- ` が後続の文字列をコメント化する

**発表者ノート**

「実コードでは検索用データを用意するWITH句が前に付きます。ここでは条件が変わる箇所だけを表示しています。ANDはORより優先されるので、公開条件を含む前半が偽でもOR 1=1で条件全体が真になります。prepareを呼んでいても、その前に入力をSQLへ埋め込めば防げません。問題はAPIの名称ではなく、入力値をSQL構文と分離できているかです。」

出典：`workshop/server.js` の `search`、特に `const sql = source + ...`

## スライド5：SQLインジェクションを防ぐ

**本文とコード：実装から抜粋・整形**

```js
const sql = source +
  'SELECT id, name, published FROM users ' +
  'WHERE published = 1 AND name LIKE ? LIMIT 50';
return lab.db.prepare(sql).all(...args, `%${keyword}%`);
```

- SQL文と入力値をバインドパラメータで分離する
- 同じ入力を修正版へ送っても非掲載名は返らない
- 通常の名前検索は維持する
- DBの読み取り権限も必要な範囲へ制限する

**発表者ノート**

「argsはWITH句で使う本人IDと検索対象データです。検索語も最後のプレースホルダーへ値として渡します。入力チェックや文字数制限だけでは、この修正の代わりになりません。LIKEの%や_の検索上の意味は別問題なので、必要なら仕様に合わせてエスケープします。修正版にも公開条件が残ることを確認します。Supabase版は同じ考え方で検索語を$3へバインドします。転送時のBase64化はSQLi対策ではありません。」

出典：`workshop/server.js`、`workshop/supabase/functions/workshop/index.ts` の `search`

## スライド6：XSSの再現

**本文**

1. Aのマイページで公開設定をONにする
2. 表示名に次を入力して「保存」を押す

```html
<img src=x onerror="celebrate()">
```

3. 保存前プレビューでは文字として表示される
4. 「ランキングを見る」を押す
5. ランキング枠に「🎉 XSSからDOMを追加できました！」が表示される

**発表者ノート**

「名前の保存はPOST …/vulnerable/profile、取得はGET …/vulnerable/rankingです。レスポンスのrows、またはpreviewに保存した文字列があるか確認します。現在の実装では、未プレイや上位10人に入っていない本人にも、公開中なら演習用のプレビュー行が出るため再現できます。これは成績記録ではありません。非公開では表示されません。画像読み込みが失敗するとonerrorが実行され、教材関数celebrateがバナーを追加します。単なるタグ挿入ではなく、JavaScript実行が観察ポイントです。」

## スライド7：XSSが起こる実装

**本文とコード：実装から抜粋**

```js
// 入力中のプレビュー
$('preview').textContent = $('profile-name').value;

// ランキングの名前表示
if (fixed || !row.allowHtml) name.textContent = row.name;
else name.innerHTML = row.name;
```

流れ：表示名の入力 → サーバーに保存 → ランキングAPIで取得 → `innerHTML` → イベント属性が実行

- 保存済みの文字列でも信頼できるとは限らない
- 安全なプレビューと危険なランキングで、同じ値の扱いが違う
- 保存型XSSであり、実行の入口はクライアント側のDOM操作

**発表者ノート**

「入力元だけでなく、最終的な描画先まで追う必要があります。ランキングはiframe内ですが、教材はallow-scriptsとallow-same-originを使う同一オリジン構成です。親ページから隔離されているとは説明しません。また、教材のランキング用CSPはインラインのイベント属性を許す設定です。すべての環境で同じペイロードが実行されるという意味ではありません。実際の影響は実行元の権限やCSPなどにも依存します。」

出典：`workshop/public/app.js` の表示名input処理、`workshop/public/ranking-frame.js`、`workshop/public/ranking-frame.html`

## スライド8：XSSを防ぐ

**本文とコード：修正方針**

```js
// 表示名はHTMLとして解釈する必要がない
name.textContent = row.name;
```

- 文字列を表示する箇所では `textContent` を使う
- HTMLが必要な場合は、用途に適したサニタイズを行う
- 出力先の文脈に応じた処理とCSPを組み合わせる
- 修正後は入力文字列がそのまま表示され、バナーは出ない

**発表者ノート**

「今回の名前表示にはHTMLが不要なので、textContentが直接的な修正です。URLやJavaScriptなど、別の文脈までtextContentで解決するという説明はしません。CSPは補助的な防御であり、危険な描画処理の修正を省く理由にはしません。修正比較は付録の固定版データを同じランキング描画へ渡して確認できます。正常な日本語名や記号入りの名前も表示できることを確認します。」

## スライド9：IDORの再現

**本文**

1. Aのマイページを開き、`GET …/vulnerable/profiles/{AのID}` を確認
2. リクエストを右クリックし「Copy as fetch」でコピー
3. ゲームページのConsoleに貼り、URL末尾のIDだけをBのIDへ変更して実行
4. Aの認証のまま、HTTP 200でBのプロフィールが返ることをNetworkで確認
5. 名前・履歴・memoなどをBのプロフィールと照合

**発表者ノート**

「Bは同じ参加コードで登録したデモ用ユーザーです。AのAuthorizationヘッダーはそのままにして、対象IDだけを変えます。別グループや存在しないIDは404なので、適当な連番を試す手順にはしません。レスポンスのmemoは未設定時に共通の既定文になります。B固有の秘密の合言葉が必ず入るとは説明せず、BのID・名前と本人用の情報が返る事実を確認します。認証済みであることと、その情報を見る権限があることは異なります。」

## スライド10：IDORが起こる実装

**本文とコード：共有APIの抜粋**

```js
const me = state.userId;
const requested = path.split('/').pop();
const id = /^\d+$/.test(requested) ? Number(requested) : NaN;
if (!Number.isSafeInteger(id) || (fixed && id !== me))
  fail(404, 'マイページが見つかりません。');
const profile = id === me ? state : await getProfile?.(id);
```

- `me` はサーバーが認証済みのセッションから決める
- 弱点版は `fixed` がfalseなので本人との照合を通過する
- 同じグループ内であることは確認するが、本人かどうかを確認しない

**発表者ノート**

「実装は弱点版と修正版で分岐しています。弱点版でもIDの形式やグループは検証しますが、それだけでは本人用プロフィールの認可として不足します。ローカルのgetProfileはWHERE id = ? AND lab_id = ?で検索しています。ここはSQLとしてパラメータ化されていますが、別の問題であるIDORは防げません。クライアントから受けたIDは取得対象を表すだけで、閲覧権限の証明ではありません。」

出典：`workshop/supabase/functions/_shared/core.js` のprofiles処理、`workshop/server.js` の `getProfile`

## スライド11：IDORを防ぐ

**本文とコード：本人専用APIの修正を示す簡略例**

```js
// meは認証済みセッションからサーバー側で取得
if (!Number.isSafeInteger(id) || id !== me) {
  fail(404, 'マイページが見つかりません。');
}
```

- 各リクエストで、対象データに対する権限をサーバー側で確認
- 本人専用なら本人IDと対象IDを照合
- 共有機能なら所有者・所属・共有権限などのルールで判定
- 修正版ではA→Aが200、A→Bが404

**発表者ノート**

「このコードは教材のfixed分岐を常時適用した説明用の簡略例です。実演ではコピーしたURLの/vulnerable/を/fixed/に変更し、AとBの両方を確認します。UUIDなど推測しにくいIDを使うことや、画面からリンクを隠すことだけでは認可を代替できません。404はこの教材の設計であり、すべてのシステムで必須のステータスという説明はしません。」

## スライド12：原因と修正の対応

| 脆弱性 | 問題の箇所 | 主な修正 | 修正後の確認 |
| --- | --- | --- | --- |
| SQLi | 入力をSQL文へ連結 | パラメータ化 | 非掲載名は取得不可、通常検索は可能 |
| XSS | 保存名をHTMLとして描画 | textContent | 文字のまま表示、JSは実行されない |
| IDOR | 対象データの認可が不足 | サーバー側で権限確認 | 他人は拒否、本人は取得可能 |

**発表者ノート**

「レビューでは検索語がSQLになる箇所、保存値がDOMに入る箇所、対象IDからデータを取得する箇所を追います。修正後は再現入力が無効になることに加え、通常操作が使えることも確認します。入力チェックだけという共通対策でまとめず、各処理で何を信頼してはいけないかを具体的に見ます。」

## 付録：発表者用の修正版確認手順

この付録は発表者ノートに入れ、本文スライドへすべて掲載しないでください。現在のUIには修正版への切り替え機能がないため、ゲームページのConsoleでAPIを呼びます。コード内のトークンは画面へ出力しません。実際の値を配布資料へ転記しないでください。

### 共通ヘルパー

入室済みのAのゲームページで実行します。HTTPエラーもステータスと本文を観察できる形にしています。POST本文は画面の実装と同じ形式です。

```js
var demoBase = window.WORKSHOP_API.replace(/\/$/, '');
var demoRequest = async (path, body) => {
  const token = sessionStorage.getItem('workshop-token:' + demoBase);
  const response = await fetch(demoBase + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    ...(body === undefined ? {} : {
      body: JSON.stringify({
        encoding: 'base64-json',
        data: btoa(String.fromCharCode(
          ...new TextEncoder().encode(JSON.stringify(body))
        ))
      })
    })
  });
  return { status: response.status, body: await response.json() };
};
```

### SQLiの修正比較

```js
await demoRequest('/fixed/directory', { q: "' OR 1=1 -- " });
await demoRequest('/fixed/directory', { q: 'デモ' });
```

期待値：前者は非掲載の架空名を含まない。後者は固定版の公開名が一致する登録者を返す。弱点版と修正版で表示名・公開設定は独立しているので、両方に同じ名前がある前提を確認する。

### XSSの修正比較

固定版にも同じ名前を保存し、固定版ランキングAPIのデータを、通常の画面と同じiframe描画コードへ渡す。これはUIのモード切り替えではなく、固定版の出力を確認する講師用操作。

```js
var fixedStatus = (await demoRequest('/fixed/status')).body;
await demoRequest('/fixed/profile', {
  name: '<img src=x onerror="celebrate()">',
  published: true,
  generation: fixedStatus.generation
});
var fixedRanking = (await demoRequest('/fixed/ranking')).body;
```

画面の「ランキングを見る」でiframeを表示・ロードしてから次を実行する。

```js
document.getElementById('ranking-frame').contentWindow.postMessage({
  type: 'ranking',
  ...fixedRanking,
  me: fixedStatus.me
}, location.origin);
```

期待値：名前が文字列として表示され、バナーは出ない。再読み込みボタンやランキングの開き直しでは画面が再び弱点版データを取得するので、比較中に押さない。終了後は弱点版の表示名も通常の名前へ戻して保存する。固定版は以下で戻せる。

```js
await demoRequest('/fixed/profile', {
  name: 'デモA', published: true, generation: fixedStatus.generation
});
```

### IDORの修正比較

```js
var selfId = (await demoRequest('/fixed/status')).body.me;
await demoRequest('/fixed/profiles/' + selfId);
// B_IDを、事前に控えた実在するデモ用ユーザーBの数値IDへ置換
await demoRequest('/fixed/profiles/' + B_ID);
```

期待値：本人は200、Bは404。弱点版では同じBのIDで200になることと対比する。

## 資料作成時に優先した実装情報

古いREADME・ANSWERSの記載と相違がある場合、この資料は以下の現行コードを優先しています。

- `workshop/public/app.js`：`mode = 'vulnerable'`、表示名保存、検索、ランキング表示
- `workshop/public/index.html`：現在のボタン名・公開設定・画面構成
- `workshop/server.js`：SQL検索、セッション、グループ内のプロフィール取得
- `workshop/supabase/functions/_shared/core.js`：本人照合、rankingのpreview、fixed分岐
- `workshop/public/ranking-frame.js`：innerHTMLとtextContentの分岐、celebrate
- `workshop/supabase/functions/workshop/index.ts`：Supabase版検索のバインド

特に「常に検索結果が3件」「IDは101/102」「架空ライバルは本人ID+1」「初期ランキング記録がある」「画面で修正版へ切り替える」「証拠コード提出UIがある」は、現在のデモ手順として採用しないでください。
