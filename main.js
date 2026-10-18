const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const timerEl = document.getElementById("timer");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayScore = document.getElementById("overlay-score");
const restartBtn = document.getElementById("restart-btn");

const {
  GAME_SECONDS,
  PLAYER_SIZE,
  COIN_SIZE,
  inputDirection,
  movePlayer,
  collectCoins,
  refillCoins,
} = window.GameLogic;

const keys = new Set();
let player, coins, score, timeLeft, running, lastTime;

function reset() {
  player = { x: canvas.width / 2, y: canvas.height / 2 };
  coins = refillCoins([], canvas.width, canvas.height);
  score = 0;
  timeLeft = GAME_SECONDS;
  running = true;
  lastTime = performance.now();
  overlay.classList.add("hidden");
  scoreEl.textContent = `Score: ${score}`;
  timerEl.textContent = `Time: ${timeLeft}`;
  requestAnimationFrame(loop);
}

function endGame() {
  running = false;
  overlayTitle.textContent = "Time Up!";
  overlayScore.textContent = `Final Score: ${score}`;
  overlay.classList.remove("hidden");
}

function update(dt) {
  player = movePlayer(player, inputDirection(keys), dt, canvas.width, canvas.height);

  const result = collectCoins(coins, player);
  if (result.gained > 0) {
    score += result.gained;
    scoreEl.textContent = `Score: ${score}`;
  }
  coins = refillCoins(result.coins, canvas.width, canvas.height);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffd25a";
  coins.forEach((coin) => {
    ctx.beginPath();
    ctx.arc(coin.x, coin.y, COIN_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#5b7fff";
  ctx.fillRect(player.x - PLAYER_SIZE / 2, player.y - PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
}

function loop(now) {
  if (!running) return;
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

setInterval(() => {
  if (!running) return;
  timeLeft -= 1;
  timerEl.textContent = `Time: ${timeLeft}`;
  if (timeLeft <= 0) endGame();
}, 1000);

window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup", (e) => keys.delete(e.code));
restartBtn.addEventListener("click", reset);

reset();
