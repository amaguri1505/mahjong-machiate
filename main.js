const L = window.MahjongLogic;
const $ = (id) => document.getElementById(id);

const timerEl = $("timer");
const timebarFill = $("timebar-fill");
const scoreEl = $("score");
const questionNoEl = $("question-no");
const modeChip = $("mode-chip");
const streakEl = $("streak");
const handEl = $("hand");
const promptEl = $("prompt");
const paletteEl = $("palette");
const revealEl = $("reveal");
const clearBtn = $("clear-btn");
const submitBtn = $("submit-btn");
const nextBtn = $("next-btn");
const startOverlay = $("start-overlay");
const endOverlay = $("end-overlay");

const KANJI_NUMS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const SUIT_CHARS = ["萬", "筒", "索"];
const HONOR_CHARS = ["東", "南", "西", "北", "", "發", "中"];
const SUIT_KEYS = ["m", "p", "s", "z"];

// phase: "ready"（開始前） / "answer"（回答中・時計が進む） / "reveal"（答え合わせ・時計停止） / "over"
let phase = "ready";
let timeLeft, score, streak, bestStreak, solved, questionNo, mode, hand, analysis, lastTick;
const selected = new Set();

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

function formatPoints(n) {
  return n.toLocaleString("ja-JP");
}

function renderStatus() {
  timerEl.textContent = timeLeft.toFixed(1);
  timerEl.classList.toggle("low", timeLeft <= 5);
  timebarFill.style.transform = `scaleX(${timeLeft / L.GAME_SECONDS})`;
  scoreEl.textContent = formatPoints(score);
}

// 表示は「次の問題がどちらのモードか」で決める（清一色で間違えたら即座に普通の手の表示に戻る）
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
  paletteEl.classList.remove("locked");
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

  revealEl.hidden = true;
  promptEl.hidden = false;
  clearBtn.hidden = false;
  submitBtn.hidden = false;
  nextBtn.hidden = true;
  phase = "answer";
  lastTick = performance.now();
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

function submit() {
  if (phase !== "answer") return;
  const correct = L.isCorrectAnswer([...selected], analysis.waits);
  let gained = 0;
  if (correct) {
    gained = analysis.best.score.total;
    score += gained;
    streak++;
    solved++;
    bestStreak = Math.max(bestStreak, streak);
  } else {
    streak = 0;
  }
  phase = "reveal";
  renderStatus();
  renderStreak();
  showReveal(correct, gained);
}

function markPalette() {
  paletteEl.classList.add("locked");
  paletteEl.querySelectorAll("button.tile").forEach((btn) => {
    const t = Number(btn.dataset.tile);
    const isWait = analysis.waits.includes(t);
    btn.classList.remove("selected");
    if (isWait && selected.has(t)) btn.classList.add("is-wait");
    else if (isWait) btn.classList.add("is-missed");
    else if (selected.has(t)) btn.classList.add("is-wrong");
  });
}

function describeScore(s) {
  if (s.yakuman) return s.rank;
  return `${s.fu}符${s.han}翻${s.rank ? ` ${s.rank}` : ""}`;
}

function showReveal(correct, gained) {
  markPalette();
  const verdict = correct
    ? `<p class="verdict ok">正解 +${formatPoints(gained)}点</p>`
    : `<p class="verdict ng">不正解<small>連続正解がリセットされました</small></p>`;

  revealEl.innerHTML = verdict;
  for (const { tile, score: s, takame } of analysis.results) {
    const row = document.createElement("div");
    row.className = "wait-row";
    row.appendChild(createTile(tile));
    const yaku = s.yaku.map((y) => (s.yakuman ? y.name : `${y.name} ${y.han}`)).join("・");
    row.insertAdjacentHTML(
      "beforeend",
      `<div class="yaku">${yaku}${takame ? '<span class="takame">高目</span>' : ""}` +
        `<span class="fu-han">${describeScore(s)}</span></div>` +
        `<div class="points">${formatPoints(s.total)}点<small>${s.ko}/${s.oya}</small></div>`
    );
    revealEl.appendChild(row);
  }

  revealEl.hidden = false;
  promptEl.hidden = true;
  clearBtn.hidden = true;
  submitBtn.hidden = true;
  nextBtn.hidden = false;
  nextBtn.focus({ preventScroll: true });
}

function startGame() {
  timeLeft = L.GAME_SECONDS;
  score = 0;
  streak = 0;
  bestStreak = 0;
  solved = 0;
  questionNo = 0;
  startOverlay.hidden = true;
  endOverlay.hidden = true;
  newQuestion();
  renderStatus();
  requestAnimationFrame(tick);
}

function endGame() {
  phase = "over";
  $("final-score").textContent = formatPoints(score);
  $("final-solved").textContent = `${solved}問`;
  $("final-streak").textContent = bestStreak;
  endOverlay.hidden = false;
  $("restart-btn").focus({ preventScroll: true });
}

function tick(now) {
  if (phase === "over" || phase === "ready") return;
  if (phase === "answer") {
    // rAF の時刻は performance.now() より前のことがあるので、負の経過時間は 0 とみなす
    timeLeft = Math.max(0, timeLeft - Math.max(0, now - lastTick) / 1000);
    renderStatus();
    if (timeLeft === 0) {
      endGame();
      return;
    }
  }
  lastTick = now;
  requestAnimationFrame(tick);
}

paletteEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button.tile");
  if (btn) toggleTile(btn);
});
clearBtn.addEventListener("click", clearSelection);
submitBtn.addEventListener("click", submit);
nextBtn.addEventListener("click", () => {
  if (phase === "reveal") newQuestion();
});
$("start-btn").addEventListener("click", startGame);
$("restart-btn").addEventListener("click", startGame);

// ゲーム中の Enter は、どのボタンにフォーカスがあっても「決定」/「次の問題」として扱う。
// 押しっぱなしの自動リピートで問題を飛ばさないよう e.repeat は無視する。
window.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || (phase !== "answer" && phase !== "reveal")) return;
  e.preventDefault();
  if (e.repeat) return;
  if (phase === "answer") submit();
  else newQuestion();
});

// 開始前もサンプルの問題を見せておく（時計は動かない）
timeLeft = L.GAME_SECONDS;
score = 0;
streak = 0;
questionNo = 0;
newQuestion();
phase = "ready";
renderStatus();
