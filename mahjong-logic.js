// 描画・DOMに依存しない麻雀ロジック（待ち判定・点数計算・出題）。
// ブラウザでは window.MahjongLogic、Node(テスト)では require() で読み込む。
//
// 牌は 0〜33 の整数で表す。
//   0〜8: 萬子1〜9 / 9〜17: 筒子1〜9 / 18〜26: 索子1〜9 / 27〜33: 東南西北白發中
// 点数計算の前提: 子・門前ツモ和了・東場南家・ドラなし・リーチなし
(function (root) {
  const TILE_KINDS = 34;
  const EAST = 27;
  const SOUTH = 28;
  const WHITE = 31;
  const GREEN = 32;
  const RED = 33;
  const YAKUHAI = [EAST, SOUTH, WHITE, GREEN, RED];
  const DRAGONS = [WHITE, GREEN, RED];
  const GREEN_TILES = [19, 20, 21, 23, 25, GREEN]; // 2・3・4・6・8索と發
  const HONOR_NAMES = ["東", "南", "西", "北", "白", "發", "中"];
  const SUIT_LETTERS = ["m", "p", "s"];
  const STREAK_FOR_CHINITSU = 6;
  const GAME_SECONDS = 30;

  const isHonor = (t) => t >= 27;
  const isTerminal = (t) => t < 27 && (t % 9 === 0 || t % 9 === 8);
  const isTerminalOrHonor = (t) => isHonor(t) || isTerminal(t);
  const suitOf = (t) => (isHonor(t) ? 3 : Math.floor(t / 9));

  // "123m456p789s11z" 形式の文字列を牌の配列にする（z は 1東 2南 3西 4北 5白 6發 7中）。
  function parseHand(str) {
    const tiles = [];
    for (const [, digits, kind] of str.matchAll(/(\d+)([mpsz])/g)) {
      for (const d of digits) {
        const n = Number(d) - 1;
        tiles.push(kind === "z" ? 27 + n : SUIT_LETTERS.indexOf(kind) * 9 + n);
      }
    }
    return tiles.sort((a, b) => a - b);
  }

  function tileName(t) {
    if (isHonor(t)) return HONOR_NAMES[t - 27];
    return `${(t % 9) + 1}${["萬", "筒", "索"][suitOf(t)]}`;
  }

  function toCounts(tiles) {
    const counts = new Array(TILE_KINDS).fill(0);
    for (const t of tiles) counts[t]++;
    return counts;
  }

  // ---- 和了形の判定 ----

  // 4面子1雀頭への分解をすべて返す。
  function decompose(original) {
    const counts = original.slice();
    const results = [];
    for (let p = 0; p < TILE_KINDS; p++) {
      if (counts[p] < 2) continue;
      counts[p] -= 2;
      findMelds(counts, 0, [], (melds) => results.push({ pair: p, melds: melds.slice() }));
      counts[p] += 2;
    }
    return results;
  }

  function findMelds(counts, start, melds, emit) {
    let i = start;
    while (i < TILE_KINDS && counts[i] === 0) i++;
    if (i === TILE_KINDS) {
      emit(melds);
      return;
    }
    if (counts[i] >= 3) {
      counts[i] -= 3;
      melds.push({ type: "trip", tile: i });
      findMelds(counts, i, melds, emit);
      melds.pop();
      counts[i] += 3;
    }
    if (!isHonor(i) && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
      counts[i]--;
      counts[i + 1]--;
      counts[i + 2]--;
      melds.push({ type: "seq", tile: i });
      findMelds(counts, i, melds, emit);
      melds.pop();
      counts[i]++;
      counts[i + 1]++;
      counts[i + 2]++;
    }
  }

  function isSevenPairs(counts) {
    return counts.filter((c) => c === 2).length === 7;
  }

  function isKokushi(counts) {
    let total = 0;
    for (let t = 0; t < TILE_KINDS; t++) {
      if (isTerminalOrHonor(t)) {
        if (counts[t] === 0) return false;
        total += counts[t];
      } else if (counts[t] > 0) {
        return false;
      }
    }
    return total === 14;
  }

  function isNineGates(counts) {
    const base = [3, 1, 1, 1, 1, 1, 1, 1, 3];
    for (let s = 0; s < 3; s++) {
      const inSuit = counts.slice(s * 9, s * 9 + 9);
      const total = inSuit.reduce((a, c) => a + c, 0);
      if (total === 14 && inSuit.every((c, i) => c >= base[i])) return true;
    }
    return false;
  }

  function isAgari(counts) {
    return isKokushi(counts) || isSevenPairs(counts) || decompose(counts).length > 0;
  }

  // 13枚の手牌の待ち牌を返す。手牌で4枚使っている牌は待ちに含めない。
  function findWaits(tiles) {
    const counts = toCounts(tiles);
    const waits = [];
    for (let t = 0; t < TILE_KINDS; t++) {
      if (counts[t] >= 4) continue;
      counts[t]++;
      if (isAgari(counts)) waits.push(t);
      counts[t]--;
    }
    return waits;
  }

  // ---- 点数計算 ----

  const ceil100 = (n) => Math.ceil(n / 100) * 100;

  // 子のツモ和了の点数。ko は子1人の支払い、oya は親の支払い。
  function tsumoPoints(han, fu, yakumanCount = 0) {
    let basic;
    let rank = "";
    if (yakumanCount > 0) {
      basic = 8000 * yakumanCount;
      rank = yakumanCount > 1 ? "ダブル役満" : "役満";
    } else if (han >= 13) {
      basic = 8000;
      rank = "数え役満";
    } else if (han >= 11) {
      basic = 6000;
      rank = "三倍満";
    } else if (han >= 8) {
      basic = 4000;
      rank = "倍満";
    } else if (han >= 6) {
      basic = 3000;
      rank = "跳満";
    } else {
      basic = fu * 2 ** (han + 2);
      if (han >= 5 || basic >= 2000) {
        basic = 2000;
        rank = "満貫";
      }
    }
    const ko = ceil100(basic);
    const oya = ceil100(basic * 2);
    return { total: ko * 2 + oya, ko, oya, rank };
  }

  function buildResult(yaku, fu) {
    const han = yaku.reduce((a, y) => a + y.han, 0);
    return { yaku, han, fu, yakuman: false, ...tsumoPoints(han, fu) };
  }

  function yakumanResult(names) {
    return {
      yaku: names.map((name) => ({ name, han: 13 })),
      han: 13 * names.length,
      fu: 0,
      yakuman: true,
      ...tsumoPoints(0, 0, names.length),
    };
  }

  // 染め手（混一色・清一色）と断么九は手牌全体で決まるので共通化する。
  function wholeHandYaku(counts) {
    const yaku = [];
    const present = [];
    for (let t = 0; t < TILE_KINDS; t++) if (counts[t] > 0) present.push(t);
    if (present.every((t) => !isTerminalOrHonor(t))) yaku.push({ name: "断么九", han: 1 });
    const suits = new Set(present.filter((t) => !isHonor(t)).map(suitOf));
    const hasHonor = present.some(isHonor);
    if (suits.size === 1 && !hasHonor) yaku.push({ name: "清一色", han: 6 });
    if (suits.size === 1 && hasHonor) yaku.push({ name: "混一色", han: 3 });
    return yaku;
  }

  // 和了牌が分解のどこに入ったかで決まる待ちの形を列挙する。
  function waitShapes(decomp, winTile) {
    const shapes = new Set();
    if (decomp.pair === winTile) shapes.add("tanki");
    for (const m of decomp.melds) {
      if (m.type === "trip") {
        if (m.tile === winTile) shapes.add("shanpon");
        continue;
      }
      const pos = winTile - m.tile;
      if (pos < 0 || pos > 2) continue;
      if (pos === 1) shapes.add("kanchan");
      else if (pos === 0) shapes.add(m.tile % 9 === 6 ? "penchan" : "ryanmen");
      else shapes.add(m.tile % 9 === 0 ? "penchan" : "ryanmen");
    }
    return [...shapes];
  }

  function meldHasTerminalOrHonor(m) {
    if (m.type === "seq") return m.tile % 9 === 0 || m.tile % 9 === 6;
    return isTerminalOrHonor(m.tile);
  }

  function scoreStandard(counts, decomp, wait) {
    const seqs = decomp.melds.filter((m) => m.type === "seq").map((m) => m.tile);
    const trips = decomp.melds.filter((m) => m.type === "trip").map((m) => m.tile);

    const yakuman = [];
    if (trips.length === 4) yakuman.push("四暗刻");
    if (DRAGONS.every((t) => trips.includes(t))) yakuman.push("大三元");
    if (isNineGates(counts)) yakuman.push("九蓮宝燈");
    if (counts.every((c, t) => c === 0 || GREEN_TILES.includes(t))) yakuman.push("緑一色");
    if (yakuman.length > 0) return yakumanResult(yakuman);

    const yaku = [{ name: "門前清自摸和", han: 1 }];
    const isPinfu = trips.length === 0 && !YAKUHAI.includes(decomp.pair) && wait === "ryanmen";
    if (isPinfu) yaku.push({ name: "平和", han: 1 });

    const seqCount = {};
    for (const s of seqs) seqCount[s] = (seqCount[s] || 0) + 1;
    const peiko = Object.values(seqCount).reduce((a, c) => a + Math.floor(c / 2), 0);
    if (peiko >= 2) yaku.push({ name: "二盃口", han: 3 });
    else if (peiko === 1) yaku.push({ name: "一盃口", han: 1 });

    for (const t of trips) {
      if (YAKUHAI.includes(t)) yaku.push({ name: `役牌 ${tileName(t)}`, han: 1 });
    }

    for (let n = 0; n < 7; n++) {
      if ([0, 1, 2].every((s) => seqs.includes(s * 9 + n))) {
        yaku.push({ name: "三色同順", han: 2 });
        break;
      }
    }
    for (let s = 0; s < 3; s++) {
      if ([0, 3, 6].every((n) => seqs.includes(s * 9 + n))) {
        yaku.push({ name: "一気通貫", han: 2 });
        break;
      }
    }
    for (let n = 0; n < 9; n++) {
      if ([0, 1, 2].every((s) => trips.includes(s * 9 + n))) {
        yaku.push({ name: "三色同刻", han: 2 });
        break;
      }
    }
    if (trips.length === 3) yaku.push({ name: "三暗刻", han: 2 });
    if (DRAGONS.includes(decomp.pair) && DRAGONS.filter((t) => trips.includes(t)).length === 2) {
      yaku.push({ name: "小三元", han: 2 });
    }

    const groupsHaveYaochu =
      isTerminalOrHonor(decomp.pair) && decomp.melds.every(meldHasTerminalOrHonor);
    if (seqs.length > 0 && groupsHaveYaochu) {
      const hasHonor = isHonor(decomp.pair) || trips.some(isHonor);
      yaku.push(hasHonor ? { name: "混全帯么九", han: 2 } : { name: "純全帯么九", han: 3 });
    }

    yaku.push(...wholeHandYaku(counts));

    let fu;
    if (isPinfu) {
      fu = 20;
    } else {
      fu = 20 + 2; // 副底 + ツモ
      for (const t of trips) fu += isTerminalOrHonor(t) ? 8 : 4; // 暗刻
      if (YAKUHAI.includes(decomp.pair)) fu += 2;
      if (wait === "kanchan" || wait === "penchan" || wait === "tanki") fu += 2;
      fu = Math.ceil(fu / 10) * 10;
    }
    return buildResult(yaku, fu);
  }

  function scoreSevenPairs(counts) {
    const yaku = [
      { name: "門前清自摸和", han: 1 },
      { name: "七対子", han: 2 },
      ...wholeHandYaku(counts),
    ];
    return buildResult(yaku, 25);
  }

  function isBetter(a, b) {
    if (a.total !== b.total) return a.total > b.total;
    if (a.han !== b.han) return a.han > b.han;
    return a.fu > b.fu;
  }

  // 13枚の手牌に winTile をツモ和了したときの最高得点の解釈を返す。和了形でなければ null。
  function scoreWin(tiles, winTile) {
    const counts = toCounts(tiles);
    counts[winTile]++;
    const candidates = [];
    if (isKokushi(counts)) candidates.push(yakumanResult(["国士無双"]));
    if (isSevenPairs(counts)) candidates.push(scoreSevenPairs(counts));
    for (const d of decompose(counts)) {
      for (const wait of waitShapes(d, winTile)) candidates.push(scoreStandard(counts, d, wait));
    }
    return candidates.reduce((best, c) => (best === null || isBetter(c, best) ? c : best), null);
  }

  // 出題用: 待ちごとの点数と高目を返す。
  // takame は他の待ちより点数が高い最高の待ちにだけ付く（全部同点なら付かない）。
  function analyzeHand(tiles) {
    const scored = findWaits(tiles).map((tile) => ({ tile, score: scoreWin(tiles, tile) }));
    const best = scored.reduce((b, r) => (b === null || isBetter(r.score, b.score) ? r : b), null);
    const hasLower = scored.some((r) => r.score.total < (best ? best.score.total : 0));
    const results = scored.map((r) => ({ ...r, takame: hasLower && r === best }));
    return { waits: results.map((r) => r.tile), results, best: results.find((r) => r.tile === best?.tile) ?? null };
  }

  // 回答の候補にする牌。普通の手は全34種、清一色は出題した色の9種。
  function answerCandidates(mode, tiles) {
    if (mode === "chinitsu") {
      const base = suitOf(tiles[0]) * 9;
      return Array.from({ length: 9 }, (_, i) => base + i);
    }
    return Array.from({ length: TILE_KINDS }, (_, i) => i);
  }

  // ---- 出題 ----

  const SEQ_RATE = 0.7;

  // 和了形（4面子1雀頭）をランダムに作って1枚抜くので、必ずテンパイになる。
  // mode: "normal"（萬筒索字の混合）または "chinitsu"（1色のみ）
  function generateHand(mode, rand = Math.random) {
    const randInt = (n) => Math.floor(rand() * n);
    for (;;) {
      const suit = randInt(3);
      const pickTile = () => (mode === "chinitsu" ? suit * 9 + randInt(9) : randInt(TILE_KINDS));
      const pickSeqStart = () => (mode === "chinitsu" ? suit : randInt(3)) * 9 + randInt(7);

      const pair = pickTile();
      const tiles = [pair, pair];
      for (let i = 0; i < 4; i++) {
        if (rand() < SEQ_RATE) {
          const s = pickSeqStart();
          tiles.push(s, s + 1, s + 2);
        } else {
          const t = pickTile();
          tiles.push(t, t, t);
        }
      }
      if (toCounts(tiles).some((c) => c > 4)) continue;
      tiles.splice(randInt(tiles.length), 1);
      return tiles.sort((a, b) => a - b);
    }
  }

  // 連続正解数から次の出題モードを決める。
  function modeForStreak(streak) {
    return streak >= STREAK_FOR_CHINITSU ? "chinitsu" : "normal";
  }

  function isCorrectAnswer(selected, waits) {
    const a = [...new Set(selected)].sort((x, y) => x - y);
    return a.length === waits.length && a.every((t, i) => t === waits[i]);
  }

  // 結果の1行表示用に役名を短くまとめる（門前清自摸和は常に付くので省く）。
  function summarizeYaku(score) {
    const names = score.yaku.map((y) => y.name).filter((n) => n !== "門前清自摸和");
    return names.length > 0 ? names.join("・") : "ツモのみ";
  }

  // ---- ランキング ----

  const NAME_MAX_LENGTH = 12;

  // 前後の空白と改行を除き、長すぎる名前は切り詰める。空なら「名無し」。
  function sanitizeName(name) {
    const cleaned = String(name ?? "").replace(/\s+/g, " ").trim();
    return [...cleaned].slice(0, NAME_MAX_LENGTH).join("") || "名無し";
  }

  // 点数の高い順。同点なら先に記録した方を上にする。
  function sortRanking(entries) {
    return entries.slice().sort((a, b) => b.score - a.score || a.at - b.at);
  }

  // 記録済みの entries の中で score が何位になるか（1始まり）。同点なら先に記録した方が上。
  function rankForScore(entries, score) {
    return entries.filter((e) => e.score >= score).length + 1;
  }

  // ---- マイページ ----

  // プレイ記録 [{score, solved, answered, bestStreak}] から成績をまとめる。
  // 正解率は答えた問題数に対する正解数（%、整数）。1問も答えていなければ null。
  function summarizePlays(plays) {
    const sum = (key) => plays.reduce((acc, p) => acc + p[key], 0);
    const answered = sum("answered");
    return {
      count: plays.length,
      best: plays.reduce((max, p) => Math.max(max, p.score), 0),
      average: plays.length > 0 ? Math.round(sum("score") / plays.length) : 0,
      accuracy: answered > 0 ? Math.round((sum("solved") / answered) * 100) : null,
      bestStreak: plays.reduce((max, p) => Math.max(max, p.bestStreak), 0),
    };
  }

  const MahjongLogic = {
    TILE_KINDS,
    STREAK_FOR_CHINITSU,
    GAME_SECONDS,
    isHonor,
    suitOf,
    parseHand,
    tileName,
    findWaits,
    tsumoPoints,
    scoreWin,
    analyzeHand,
    answerCandidates,
    generateHand,
    modeForStreak,
    isCorrectAnswer,
    summarizeYaku,
    NAME_MAX_LENGTH,
    sanitizeName,
    sortRanking,
    rankForScore,
    summarizePlays,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = MahjongLogic;
  } else {
    root.MahjongLogic = MahjongLogic;
  }
})(this);
