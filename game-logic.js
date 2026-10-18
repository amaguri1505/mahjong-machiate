// 描画・DOMに依存しないゲームロジック。
// ブラウザでは window.GameLogic、Node(テスト)では require() で読み込む。
(function (root) {
  const GAME_SECONDS = 30;
  const PLAYER_SIZE = 24;
  const PLAYER_SPEED = 240; // px/sec
  const COIN_SIZE = 14;
  const COIN_COUNT = 8;
  const COIN_SCORE = 10;

  function randCoin(width, height, rand = Math.random) {
    return {
      x: COIN_SIZE + rand() * (width - COIN_SIZE * 2),
      y: COIN_SIZE + rand() * (height - COIN_SIZE * 2),
    };
  }

  // keys: 押下中のキーコードの Set。正規化した移動方向を返す。
  function inputDirection(keys) {
    let dx = 0;
    let dy = 0;
    if (keys.has("ArrowUp") || keys.has("KeyW")) dy -= 1;
    if (keys.has("ArrowDown") || keys.has("KeyS")) dy += 1;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) dx -= 1;
    if (keys.has("ArrowRight") || keys.has("KeyD")) dx += 1;
    if (dx === 0 && dy === 0) return { dx: 0, dy: 0 };
    const len = Math.hypot(dx, dy);
    return { dx: dx / len, dy: dy / len };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function movePlayer(player, dir, dt, width, height) {
    const half = PLAYER_SIZE / 2;
    return {
      x: clamp(player.x + dir.dx * PLAYER_SPEED * dt, half, width - half),
      y: clamp(player.y + dir.dy * PLAYER_SPEED * dt, half, height - half),
    };
  }

  function isCoinHit(coin, player) {
    return Math.hypot(coin.x - player.x, coin.y - player.y) < (PLAYER_SIZE + COIN_SIZE) / 2;
  }

  // 触れたコインを取り除き、獲得点を返す。
  function collectCoins(coins, player) {
    const remaining = coins.filter((coin) => !isCoinHit(coin, player));
    return { coins: remaining, gained: (coins.length - remaining.length) * COIN_SCORE };
  }

  function refillCoins(coins, width, height, rand = Math.random) {
    const result = coins.slice();
    while (result.length < COIN_COUNT) result.push(randCoin(width, height, rand));
    return result;
  }

  const GameLogic = {
    GAME_SECONDS,
    PLAYER_SIZE,
    PLAYER_SPEED,
    COIN_SIZE,
    COIN_COUNT,
    COIN_SCORE,
    randCoin,
    inputDirection,
    movePlayer,
    isCoinHit,
    collectCoins,
    refillCoins,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = GameLogic;
  } else {
    root.GameLogic = GameLogic;
  }
})(this);
