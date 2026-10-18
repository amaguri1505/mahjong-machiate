const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const timerEl = document.getElementById("timer");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayScore = document.getElementById("overlay-score");
const restartBtn = document.getElementById("restart-btn");

const GAME_SECONDS = 30;
const PLAYER_SIZE = 24;
const PLAYER_SPEED = 240; // px/sec
const COIN_SIZE = 14;
const COIN_COUNT = 8;

const keys = new Set();
let player, coins, score, timeLeft, running, lastTime;

function randCoin() {
  return {
    x: COIN_SIZE + Math.random() * (canvas.width - COIN_SIZE * 2),
    y: COIN_SIZE + Math.random() * (canvas.height - COIN_SIZE * 2),
  };
}

function reset() {
  player = { x: canvas.width / 2, y: canvas.height / 2 };
  coins = Array.from({ length: COIN_COUNT }, randCoin);
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
  let dx = 0;
  let dy = 0;
  if (keys.has("ArrowUp") || keys.has("KeyW")) dy -= 1;
  if (keys.has("ArrowDown") || keys.has("KeyS")) dy += 1;
  if (keys.has("ArrowLeft") || keys.has("KeyA")) dx -= 1;
  if (keys.has("ArrowRight") || keys.has("KeyD")) dx += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    player.x += (dx / len) * PLAYER_SPEED * dt;
    player.y += (dy / len) * PLAYER_SPEED * dt;
  }

  player.x = Math.max(PLAYER_SIZE / 2, Math.min(canvas.width - PLAYER_SIZE / 2, player.x));
  player.y = Math.max(PLAYER_SIZE / 2, Math.min(canvas.height - PLAYER_SIZE / 2, player.y));

  coins = coins.filter((coin) => {
    const hit = Math.hypot(coin.x - player.x, coin.y - player.y) < (PLAYER_SIZE + COIN_SIZE) / 2;
    if (hit) {
      score += 10;
      scoreEl.textContent = `Score: ${score}`;
    }
    return !hit;
  });

  while (coins.length < COIN_COUNT) {
    coins.push(randCoin());
  }
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
