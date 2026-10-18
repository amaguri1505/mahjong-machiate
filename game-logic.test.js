const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("./game-logic.js");

const W = 800;
const H = 480;

test("inputDirection: キーなしなら静止", () => {
  assert.deepEqual(L.inputDirection(new Set()), { dx: 0, dy: 0 });
});

test("inputDirection: 矢印キーとWASDの両方に反応する", () => {
  assert.deepEqual(L.inputDirection(new Set(["ArrowRight"])), { dx: 1, dy: 0 });
  assert.deepEqual(L.inputDirection(new Set(["KeyW"])), { dx: 0, dy: -1 });
});

test("inputDirection: 斜め移動は長さ1に正規化される", () => {
  const dir = L.inputDirection(new Set(["ArrowUp", "ArrowRight"]));
  assert.ok(Math.abs(Math.hypot(dir.dx, dir.dy) - 1) < 1e-9);
});

test("inputDirection: 逆方向の同時押しは打ち消し合う", () => {
  assert.deepEqual(L.inputDirection(new Set(["ArrowLeft", "KeyD"])), { dx: 0, dy: 0 });
});

test("movePlayer: 速度×時間だけ移動する", () => {
  const p = L.movePlayer({ x: 100, y: 100 }, { dx: 1, dy: 0 }, 0.5, W, H);
  assert.deepEqual(p, { x: 100 + L.PLAYER_SPEED * 0.5, y: 100 });
});

test("movePlayer: 画面外に出ない", () => {
  const half = L.PLAYER_SIZE / 2;
  assert.deepEqual(L.movePlayer({ x: 5, y: 5 }, { dx: -1, dy: -1 }, 1, W, H), { x: half, y: half });
  assert.deepEqual(L.movePlayer({ x: W, y: H }, { dx: 1, dy: 1 }, 1, W, H), { x: W - half, y: H - half });
});

test("isCoinHit: 半径の和より近ければ取得、離れていれば取得しない", () => {
  const player = { x: 100, y: 100 };
  const touch = (L.PLAYER_SIZE + L.COIN_SIZE) / 2;
  assert.equal(L.isCoinHit({ x: 100 + touch - 0.1, y: 100 }, player), true);
  assert.equal(L.isCoinHit({ x: 100 + touch, y: 100 }, player), false);
});

test("collectCoins: 触れたコインだけ消え、1枚につきCOIN_SCORE加点", () => {
  const player = { x: 100, y: 100 };
  const coins = [{ x: 100, y: 100 }, { x: 105, y: 100 }, { x: 500, y: 300 }];
  const result = L.collectCoins(coins, player);
  assert.deepEqual(result.coins, [{ x: 500, y: 300 }]);
  assert.equal(result.gained, 2 * L.COIN_SCORE);
});

test("collectCoins: 元の配列を変更しない", () => {
  const coins = [{ x: 100, y: 100 }];
  L.collectCoins(coins, { x: 100, y: 100 });
  assert.equal(coins.length, 1);
});

test("refillCoins: COIN_COUNT枚まで補充し、画面内に配置する", () => {
  const coins = L.refillCoins([], W, H);
  assert.equal(coins.length, L.COIN_COUNT);
  for (const c of coins) {
    assert.ok(c.x >= L.COIN_SIZE && c.x <= W - L.COIN_SIZE);
    assert.ok(c.y >= L.COIN_SIZE && c.y <= H - L.COIN_SIZE);
  }
});

test("randCoin: 乱数の端の値でも画面内に収まる", () => {
  assert.deepEqual(L.randCoin(W, H, () => 0), { x: L.COIN_SIZE, y: L.COIN_SIZE });
  const max = L.randCoin(W, H, () => 0.999999);
  assert.ok(max.x < W - L.COIN_SIZE && max.y < H - L.COIN_SIZE);
});
