const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("./mahjong-logic.js");

const P = L.parseHand;
const names = (r) => r.yaku.map((y) => y.name);

// ---- 牌の表記 ----

test("parseHand: 表記を牌番号に変換しソートする", () => {
  assert.deepEqual(P("1s1p9p1m"), [0, 9, 17, 18]);
  assert.deepEqual(P("7z1z"), [27, 33]);
});

test("tileName: 数牌と字牌の名前", () => {
  assert.equal(L.tileName(P("5p")[0]), "5筒");
  assert.equal(L.tileName(P("6z")[0]), "發");
});

// ---- 待ち判定 ----

test("findWaits: 両面待ち", () => {
  assert.deepEqual(L.findWaits(P("234m567p789s23s88p")), P("1s4s"));
});

test("findWaits: 三面張", () => {
  assert.deepEqual(L.findWaits(P("234m567p456s23s88p")), P("1s4s7s"));
});

test("findWaits: ノベタン", () => {
  assert.deepEqual(L.findWaits(P("2345m123p456p789s")), P("2m5m"));
});

test("findWaits: 九蓮宝燈は9面待ち", () => {
  assert.deepEqual(L.findWaits(P("1112345678999m")), P("123456789m"));
});

test("findWaits: 七対子の単騎", () => {
  assert.deepEqual(L.findWaits(P("1122m3344p5566s7z")), P("7z"));
});

test("findWaits: 国士無双13面待ち", () => {
  assert.deepEqual(L.findWaits(P("19m19p19s1234567z")), P("19m19p19s1234567z"));
});

test("findWaits: 手牌で4枚使っている牌は待ちにならない", () => {
  // 2222m の単騎は5枚目が存在しないのでノーテン
  assert.deepEqual(L.findWaits(P("2222m345p678p999s")), []);
});

test("findWaits: ノーテンなら空", () => {
  assert.deepEqual(L.findWaits(P("159m159p159s1234z")), []);
});

// ---- 点数計算 ----

test("tsumoPoints: 子のツモの代表的な点数", () => {
  assert.equal(L.tsumoPoints(1, 30).total, 1100); // 300/500
  assert.equal(L.tsumoPoints(2, 20).total, 1500); // 400/700
  assert.equal(L.tsumoPoints(3, 30).total, 4000); // 1000/2000
  assert.equal(L.tsumoPoints(4, 30).total, 7900); // 2000/3900
  assert.equal(L.tsumoPoints(3, 25).total, 3200); // 800/1600
});

test("tsumoPoints: 満貫以上", () => {
  assert.deepEqual(L.tsumoPoints(4, 40), { total: 8000, ko: 2000, oya: 4000, rank: "満貫" });
  assert.equal(L.tsumoPoints(5, 30).total, 8000);
  assert.equal(L.tsumoPoints(6, 30).rank, "跳満");
  assert.equal(L.tsumoPoints(7, 30).total, 12000);
  assert.equal(L.tsumoPoints(8, 30).total, 16000);
  assert.equal(L.tsumoPoints(11, 30).total, 24000);
  assert.equal(L.tsumoPoints(13, 30).rank, "数え役満");
  assert.equal(L.tsumoPoints(0, 0, 1).total, 32000);
  assert.equal(L.tsumoPoints(0, 0, 2).total, 64000);
});

test("scoreWin: 平和ツモは20符2翻で1500点", () => {
  const r = L.scoreWin(P("234m567p456s23s88p"), P("1s")[0]);
  assert.deepEqual(names(r), ["門前清自摸和", "平和"]);
  assert.equal(r.fu, 20);
  assert.equal(r.total, 1500);
});

test("scoreWin: 平和ツモ断么九は2700点", () => {
  const r = L.scoreWin(P("234m567p456s23s88p"), P("4s")[0]);
  assert.deepEqual(names(r), ["門前清自摸和", "平和", "断么九"]);
  assert.equal(r.total, 2700);
});

test("scoreWin: 嵌張待ちは符が付き平和にならない", () => {
  const r = L.scoreWin(P("13m456p789s234s55p"), P("2m")[0]);
  assert.deepEqual(names(r), ["門前清自摸和"]);
  assert.equal(r.fu, 30);
  assert.equal(r.total, 1100);
});

test("scoreWin: 七対子より高い二盃口の解釈を選ぶ", () => {
  const r = L.scoreWin(P("112233m445566p7z"), P("7z")[0]);
  assert.ok(names(r).includes("二盃口"));
  assert.ok(!names(r).includes("七対子"));
  assert.equal(r.total, 7900); // 4翻30符
});

test("scoreWin: 七対子は25符", () => {
  const r = L.scoreWin(P("1122m3344p5566s7z"), P("7z")[0]);
  assert.deepEqual(names(r), ["門前清自摸和", "七対子"]);
  assert.equal(r.fu, 25);
  assert.equal(r.total, 3200);
});

test("scoreWin: 役牌", () => {
  const r = L.scoreWin(P("555z234m678p345s1s"), P("1s")[0]);
  assert.ok(names(r).includes("役牌 白"));
});

test("scoreWin: 三色同順と一気通貫", () => {
  const sanshoku = L.scoreWin(P("234m234p234s678m5p"), P("5p")[0]);
  assert.ok(names(sanshoku).includes("三色同順"));
  const ittsu = L.scoreWin(P("123456789m234p5s"), P("5s")[0]);
  assert.ok(names(ittsu).includes("一気通貫"));
});

test("scoreWin: 清一色は跳満以上", () => {
  const tiles = P("1112233456789m");
  const { results } = L.analyzeHand(tiles);
  assert.ok(results.length > 0);
  for (const { score } of results) {
    assert.ok(names(score).includes("清一色"));
    assert.ok(score.total >= 12000);
  }
});

test("scoreWin: 混一色", () => {
  const r = L.scoreWin(P("123456m789m111z2m"), P("2m")[0]);
  assert.ok(names(r).includes("混一色"));
});

test("scoreWin: 四暗刻・国士無双・九蓮宝燈は役満", () => {
  assert.equal(L.scoreWin(P("111m222p333s44z55z"), P("4z")[0]).total, 32000);
  assert.deepEqual(names(L.scoreWin(P("19m19p19s1234567z"), P("1m")[0])), ["国士無双"]);
  assert.deepEqual(names(L.scoreWin(P("1112345678999m"), P("5m")[0])), ["九蓮宝燈"]);
});

test("scoreWin: 小三元", () => {
  const r = L.scoreWin(P("555z666z77z234m67m"), P("5m")[0]);
  assert.ok(names(r).includes("小三元"));
  assert.ok(names(r).includes("役牌 白") && names(r).includes("役牌 發"));
});

test("scoreWin: 三色同刻", () => {
  const r = L.scoreWin(P("111m111p111s234s5s"), P("5s")[0]);
  assert.ok(names(r).includes("三色同刻"));
  assert.ok(names(r).includes("三暗刻"));
});

test("scoreWin: 緑一色は役満", () => {
  const r = L.scoreWin(P("234s234s666s888s6z"), P("6z")[0]);
  assert.deepEqual(names(r), ["緑一色"]);
  assert.equal(r.total, 32000);
});

test("scoreWin: 和了形でなければ null", () => {
  assert.equal(L.scoreWin(P("2222m345p678p999s"), P("1m")[0]), null);
});

test("analyzeHand: 高目を選ぶ", () => {
  const { waits, best } = L.analyzeHand(P("234m567p456s23s88p"));
  assert.deepEqual(waits, P("1s4s7s"));
  assert.ok(P("4s7s").includes(best.tile)); // 1s は1500点、4s/7s は断么九が付いて2700点
  assert.equal(best.score.total, 2700);
});

test("analyzeHand: 全部同点なら高目を付けない", () => {
  // 1199m のシャンポン待ちはどちらでも 40符1翻 1500点
  const { results } = L.analyzeHand(P("1199m234p234s777s"));
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.score.total === 1500 && !r.takame));
});

test("analyzeHand: 高目は最高点の待ち1つだけに付く", () => {
  const { results } = L.analyzeHand(P("234m567p456s23s88p"));
  assert.equal(results.filter((r) => r.takame).length, 1);
  assert.ok(!results.find((r) => r.tile === P("1s")[0]).takame);
});

// ---- 出題とゲーム進行 ----

test("answerCandidates: 普通の手は34種、清一色はその色の9種", () => {
  assert.equal(L.answerCandidates("normal", P("1112345678999m")).length, 34);
  assert.deepEqual(L.answerCandidates("chinitsu", P("1112345678999p")), P("123456789p"));
});

test("generateHand: 普通の手は13枚・同じ牌は4枚以下・必ずテンパイ", () => {
  for (let i = 0; i < 300; i++) {
    const tiles = L.generateHand("normal");
    assert.equal(tiles.length, 13);
    const counts = {};
    for (const t of tiles) counts[t] = (counts[t] || 0) + 1;
    assert.ok(Object.values(counts).every((c) => c <= 4));
    assert.ok(L.findWaits(tiles).length > 0);
  }
});

test("generateHand: 清一色は1色のみで必ずテンパイ", () => {
  for (let i = 0; i < 300; i++) {
    const tiles = L.generateHand("chinitsu");
    assert.equal(new Set(tiles.map(L.suitOf)).size, 1);
    assert.ok(!tiles.some(L.isHonor));
    assert.ok(L.findWaits(tiles).length > 0);
  }
});

test("modeForStreak: 3問連続正解で清一色になる", () => {
  assert.equal(L.modeForStreak(0), "normal");
  assert.equal(L.modeForStreak(2), "normal");
  assert.equal(L.modeForStreak(3), "chinitsu");
  assert.equal(L.modeForStreak(10), "chinitsu");
});

test("isCorrectAnswer: 過不足なく選んだときだけ正解", () => {
  const waits = P("1s4s");
  assert.equal(L.isCorrectAnswer(P("4s1s"), waits), true);
  assert.equal(L.isCorrectAnswer(P("1s"), waits), false);
  assert.equal(L.isCorrectAnswer(P("1s4s7s"), waits), false);
  assert.equal(L.isCorrectAnswer([], waits), false);
});

test("summarizeYaku: 門前清自摸和を省いて役名をつなぐ", () => {
  const pinfu = L.scoreWin(P("234m567p456s23s88p"), P("4s")[0]);
  assert.equal(L.summarizeYaku(pinfu), "平和・断么九");
  const tsumoOnly = L.scoreWin(P("13m456p789s234s55p"), P("2m")[0]);
  assert.equal(L.summarizeYaku(tsumoOnly), "ツモのみ");
});

// ---- ランキング ----

test("sanitizeName: 空白を整え、長すぎる名前は切り詰め、空なら名無し", () => {
  assert.equal(L.sanitizeName("  さとし \n"), "さとし");
  assert.equal(L.sanitizeName("あいうえおかきくけこさしすせそ"), "あいうえおかきくけこさし");
  assert.equal(L.sanitizeName("   "), "名無し");
  assert.equal(L.sanitizeName(undefined), "名無し");
});

test("rankForScore: 同点の既存記録より下に入る", () => {
  const entries = [{ score: 8000 }, { score: 2700 }, { score: 1500 }];
  assert.equal(L.rankForScore(entries, 9000), 1);
  assert.equal(L.rankForScore(entries, 2700), 3);
  assert.equal(L.rankForScore(entries, 0), 4);
  assert.equal(L.rankForScore([], 1500), 1);
});

test("sortRanking: 点数の高い順、同点は先に記録した方が上", () => {
  const sorted = L.sortRanking([
    { name: "A", score: 1500, at: 1 },
    { name: "B", score: 8000, at: 3 },
    { name: "C", score: 8000, at: 2 },
  ]);
  assert.deepEqual(sorted.map((e) => e.name), ["C", "B", "A"]);
});

test("summarizePlays: 最高点・平均点・正解率・最高連続をまとめる", () => {
  const s = L.summarizePlays([
    { score: 8000, solved: 4, answered: 5, bestStreak: 3 },
    { score: 1500, solved: 1, answered: 3, bestStreak: 1 },
    { score: 0, solved: 0, answered: 2, bestStreak: 0 },
  ]);
  assert.deepEqual(s, { count: 3, best: 8000, average: 3167, accuracy: 50, bestStreak: 3 });
});

test("summarizePlays: 記録がなければ0、1問も答えていなければ正解率は null", () => {
  assert.deepEqual(L.summarizePlays([]), { count: 0, best: 0, average: 0, accuracy: null, bestStreak: 0 });
  assert.equal(L.summarizePlays([{ score: 0, solved: 0, answered: 0, bestStreak: 0 }]).accuracy, null);
});
