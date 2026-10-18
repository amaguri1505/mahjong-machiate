const L = window.MahjongLogic;
const $ = (id) => document.getElementById(id);

const timerEl = $("timer");
const timebarFill = $("timebar-fill");
const scoreEl = $("score");
const questionEl = $("question");
const questionNoEl = $("question-no");
const modeChip = $("mode-chip");
const streakEl = $("streak");
const handEl = $("hand");
const paletteEl = $("palette");
const lastResultEl = $("last-result");
const startOverlay = $("start-overlay");
const endOverlay = $("end-overlay");
const entryForm = $("entry-form");
const nameInput = $("player-name");
const entryBtn = $("entry-btn");
const entryStatus = $("entry-status");
const rankingTitle = $("ranking-title");
const rankingList = $("ranking-list");
const rankingEmpty = $("ranking-empty");
const reviewList = $("review-list");

const KANJI_NUMS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const SUIT_CHARS = ["萬", "筒", "索"];
const HONOR_CHARS = ["東", "南", "西", "北", "", "發", "中"];
const SUIT_KEYS = ["m", "p", "s", "z"];
const NAME_KEY = "mahjong-wait-quiz:name";

// phase: "ready"（開始前） / "answer"（回答中） / "over"（時間切れ）
let phase = "ready";
let timeLeft, score, streak, bestStreak, solved, questionNo, mode, hand, analysis, lastTick;
let history = [];
const selected = new Set();

let rankingStore = null;
let rankingEntries = [];
let myEntryId = null;

function createTile(t, tag = "div") {
  const el = document.createElement(tag);
  el.className = "tile";
  el.dataset.suit = SUIT_KEYS[L.suitOf(t)];
  el.setAttribute("aria-label", L.tileName(t));
  if (L.isHonor(t)) {
    el.dataset.honor = t - 27;
    el.innerHTML = `<span class="glyph">${HONOR_CHARS[t - 27]}</span>`;
  } else {
    el.innerHTML = `<span class="num">${KANJI_NUMS[t % 9]}</span><span class="suit">${SUIT_CHARS[L.suitOf(t)]}</span>`;
  }
  return el;
}

function miniTiles(tiles) {
  const wrap = document.createElement("span");
  wrap.className = "mini-tiles";
  tiles.forEach((t) => {
    const el = createTile(t);
    el.classList.add("mini");
    wrap.appendChild(el);
  });
  return wrap;
}

function formatPoints(n) {
  return n.toLocaleString("ja-JP");
}

function renderStatus() {
  timerEl.textContent = timeLeft.toFixed(1);
  timerEl.classList.toggle("low", timeLeft <= 5);
  timebarFill.style.transform = `scaleX(${timeLeft / L.GAME_SECONDS})`;
  scoreEl.textContent = formatPoints(score);
}

function renderStreak() {
  if (L.modeForStreak(streak) === "chinitsu") {
    streakEl.textContent = `連続正解 ${streak}`;
    return;
  }
  const pips = Array.from(
    { length: L.STREAK_FOR_CHINITSU },
    (_, i) => `<span class="pip${i < streak ? " on" : ""}"></span>`
  ).join("");
  streakEl.innerHTML = `清一色まであと${L.STREAK_FOR_CHINITSU - streak}<span class="pips">${pips}</span>`;
}

function renderPalette() {
  paletteEl.innerHTML = "";
  paletteEl.classList.toggle("single", mode === "chinitsu");
  for (const t of L.answerCandidates(mode, hand)) {
    const btn = createTile(t, "button");
    btn.type = "button";
    btn.dataset.tile = t;
    btn.setAttribute("aria-pressed", "false");
    paletteEl.appendChild(btn);
  }
}

function newQuestion() {
  mode = L.modeForStreak(streak);
  hand = L.generateHand(mode);
  analysis = L.analyzeHand(hand);
  selected.clear();
  questionNo++;

  questionNoEl.textContent = `第${questionNo}問`;
  modeChip.textContent = mode === "chinitsu" ? "清一色" : "普通の手";
  modeChip.classList.toggle("chinitsu", mode === "chinitsu");
  renderStreak();

  handEl.innerHTML = "";
  hand.forEach((t) => handEl.appendChild(createTile(t)));
  renderPalette();
}

function toggleTile(btn) {
  if (phase !== "answer") return;
  const t = Number(btn.dataset.tile);
  if (selected.has(t)) selected.delete(t);
  else selected.add(t);
  btn.classList.toggle("selected", selected.has(t));
  btn.setAttribute("aria-pressed", String(selected.has(t)));
}

function clearSelection() {
  if (phase !== "answer") return;
  selected.clear();
  paletteEl.querySelectorAll("button.tile").forEach((btn) => {
    btn.classList.remove("selected");
    btn.setAttribute("aria-pressed", "false");
  });
}

function flash(correct) {
  questionEl.classList.remove("flash-ok", "flash-ng");
  void questionEl.offsetWidth; // 連続で答えてもアニメーションをやり直す
  questionEl.classList.add(correct ? "flash-ok" : "flash-ng");
}

// 答えたらダイアログは出さずに次の問題へ進み、前の問題の結果だけを1行で残す。
function submit() {
  if (phase !== "answer") return;
  const correct = L.isCorrectAnswer([...selected], analysis.waits);
  const gained = correct ? analysis.best.score.total : 0;
  if (correct) {
    score += gained;
    streak++;
    solved++;
    bestStreak = Math.max(bestStreak, streak);
  } else {
    streak = 0;
  }
  history.push({ no: questionNo, mode, hand, analysis, correct, gained });
  flash(correct);
  renderLastResult(history[history.length - 1]);
  renderStatus();
  newQuestion();
}

function renderLastResult(entry) {
  const best = entry.analysis.best.score;
  lastResultEl.replaceChildren();
  lastResultEl.className = `last-result ${entry.correct ? "ok" : "ng"}`;
  lastResultEl.append(
    Object.assign(document.createElement("span"), {
      className: "mark",
      textContent: entry.correct ? "○" : "×",
    }),
    Object.assign(document.createElement("span"), {
      className: "label",
      textContent: entry.correct ? "前の問題" : "前の問題の正解",
    }),
    miniTiles(entry.analysis.waits),
    Object.assign(document.createElement("span"), {
      className: "yaku",
      textContent: L.summarizeYaku(best),
    }),
    Object.assign(document.createElement("span"), {
      className: "points",
      textContent: entry.correct ? `+${formatPoints(entry.gained)}` : `${formatPoints(best.total)}点`,
    })
  );
  lastResultEl.hidden = false;
}

function renderReview() {
  reviewList.replaceChildren();
  for (const entry of history) {
    const best = entry.analysis.best.score;
    const li = document.createElement("li");
    li.className = entry.correct ? "ok" : "ng";
    const head = document.createElement("div");
    head.className = "review-head";
    head.textContent =
      `第${entry.no}問 ${entry.correct ? "○" : "×"} ${entry.mode === "chinitsu" ? "清一色" : "普通の手"}` +
      ` / ${L.summarizeYaku(best)} ${formatPoints(best.total)}点`;
    const waits = document.createElement("div");
    waits.className = "review-tiles";
    waits.append(miniTiles(entry.hand), Object.assign(document.createElement("span"), { textContent: "待ち" }), miniTiles(entry.analysis.waits));
    li.append(head, waits);
    reviewList.appendChild(li);
  }
  if (history.length === 0) {
    reviewList.innerHTML = "<li>答えた問題はありません。</li>";
  }
}

function startGame() {
  timeLeft = L.GAME_SECONDS;
  score = 0;
  streak = 0;
  bestStreak = 0;
  solved = 0;
  questionNo = 0;
  history = [];
  myEntryId = null;
  lastResultEl.hidden = true;
  startOverlay.hidden = true;
  endOverlay.hidden = true;
  newQuestion();
  renderStatus();
  phase = "answer";
  lastTick = performance.now();
  requestAnimationFrame(tick);
}

function endGame() {
  phase = "over";
  $("final-score").textContent = formatPoints(score);
  $("final-solved").textContent = `${solved}問`;
  $("final-streak").textContent = bestStreak;
  entryForm.hidden = false;
  entryBtn.disabled = false;
  nameInput.disabled = false;
  entryStatus.textContent = "";
  renderReview();
  renderRanking();
  endOverlay.hidden = false;
  endOverlay.scrollTop = 0;
}

function tick(now) {
  if (phase !== "answer") return;
  // rAF の時刻は performance.now() より前のことがあるので、負の経過時間は 0 とみなす
  timeLeft = Math.max(0, timeLeft - Math.max(0, now - lastTick) / 1000);
  lastTick = now;
  renderStatus();
  if (timeLeft === 0) {
    endGame();
    return;
  }
  requestAnimationFrame(tick);
}

// ---- ランキング ----

function renderRanking() {
  rankingList.replaceChildren();
  rankingEntries.forEach((e, i) => {
    const li = document.createElement("li");
    if (e.id === myEntryId) li.className = "mine";
    const rank = Object.assign(document.createElement("span"), { className: "rank", textContent: `${i + 1}` });
    const name = Object.assign(document.createElement("span"), { className: "name", textContent: e.name });
    const detail = Object.assign(document.createElement("span"), {
      className: "detail",
      textContent: `${e.solved}問`,
    });
    const points = Object.assign(document.createElement("span"), {
      className: "points",
      textContent: formatPoints(e.score),
    });
    li.append(rank, name, detail, points);
    rankingList.appendChild(li);
  });
  rankingEmpty.hidden = rankingEntries.length > 0;
}

async function setupRanking() {
  rankingStore = await window.Ranking.openRankingStore();
  rankingTitle.textContent = rankingStore.shared
    ? `ランキング 上位${window.Ranking.TOP_N}`
    : `この端末のランキング 上位${window.Ranking.TOP_N}`;
  rankingStore.subscribe(
    (entries) => {
      rankingEntries = entries;
      renderRanking();
    },
    () => {
      rankingTitle.textContent = "ランキングを読み込めませんでした";
    }
  );
}

async function registerScore(e) {
  e.preventDefault();
  if (!rankingStore || myEntryId) return;
  const name = L.sanitizeName(nameInput.value);
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // 名前を覚えられなくても登録は続ける
  }
  entryBtn.disabled = true;
  nameInput.disabled = true;
  entryStatus.textContent = "登録しています…";
  try {
    // 共有DBでは一覧の更新が少し遅れて届くので、順位は登録前の一覧から求める
    const rank = L.rankForScore(rankingEntries, score);
    myEntryId = await rankingStore.add({ name, score, solved, bestStreak, at: Date.now() });
    renderRanking();
    entryStatus.textContent =
      rank <= window.Ranking.TOP_N
        ? `${rank}位で登録しました。`
        : `登録しました。上位${window.Ranking.TOP_N}位には入りませんでした。`;
  } catch {
    entryBtn.disabled = false;
    nameInput.disabled = false;
    entryStatus.textContent = "登録できませんでした。時間をおいてもう一度お試しください。";
  }
}

// ---- 入力 ----

paletteEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button.tile");
  if (btn) toggleTile(btn);
});
$("clear-btn").addEventListener("click", clearSelection);
$("submit-btn").addEventListener("click", submit);
$("start-btn").addEventListener("click", startGame);
$("restart-btn").addEventListener("click", startGame);
entryForm.addEventListener("submit", registerScore);

// 回答中の Enter は、どのボタンにフォーカスがあっても「決定」として扱う。
// 押しっぱなしの自動リピートで空の回答を送らないよう e.repeat は無視する。
window.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || phase !== "answer") return;
  e.preventDefault();
  if (!e.repeat) submit();
});

try {
  nameInput.value = localStorage.getItem(NAME_KEY) || "";
} catch {
  // 保存した名前が読めなくても入力欄が空になるだけ
}
nameInput.maxLength = L.NAME_MAX_LENGTH;

// 開始前もサンプルの問題を見せておく（時計は動かない）
timeLeft = L.GAME_SECONDS;
score = 0;
streak = 0;
questionNo = 0;
newQuestion();
renderStatus();
setupRanking();
