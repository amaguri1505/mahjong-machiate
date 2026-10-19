const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const logic = require('../mahjong-logic');

test('中断: タイマーと保存を止めて開始画面へ戻り、次のゲームは30秒・0点から始まる', async () => {
  const elements = new Map();
  function element() {
    return { hidden: true, textContent: '', value: '', style: {}, dataset: {}, handlers: {},
      classList: { add() {}, remove() {}, toggle() {} },
      append() {}, appendChild() {}, replaceChildren() {}, setAttribute() {}, focus() { this.focused = true; },
      querySelectorAll: () => [], addEventListener(name, fn) { this.handlers[name] = fn; }
    };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const frames = new Map(); let nextFrame = 0, saves = 0;
  const events = [];
  const window = { MahjongLogic: logic, TileArt: { tileArt: () => '' },
    Account: { current: () => ({ id: 101 }), onChange() {} }, Online: { rankingPerUser: true },
    Ranking: { TOP_N: 10, openRankingStore: async () => ({ online: true, shared: true, subscribe(fn) { fn([]); }, refresh() {}, async add() { saves++; } }) },
    addEventListener() {}, dispatchEvent(event) { events.push(event.type); }
  };
  const context = vm.createContext({ window,
    document: { getElementById: get, createElement: element, querySelectorAll: () => [] },
    localStorage: { getItem: () => null }, performance: { now: () => 1000 },
    requestAnimationFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); }, CustomEvent: class { constructor(type) { this.type = type; } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  get('start-btn').handlers.click();
  vm.runInContext('score = 12000; solved = 2; timeLeft = 10;', context);
  assert.equal(frames.size, 1);
  assert.equal(get('interrupt-btn').hidden, false);
  get('interrupt-btn').handlers.click();
  assert.equal(vm.runInContext('phase', context), 'ready');
  assert.equal(frames.size, 0);
  assert.equal(get('start-overlay').hidden, false);
  assert.equal(get('end-overlay').hidden, true);
  assert.equal(get('interrupt-btn').hidden, true);
  assert.equal(get('start-btn').focused, true);
  assert.deepEqual(events, ['game-interrupted']);
  assert.equal(saves, 0);
  get('start-btn').handlers.click();
  assert.equal(vm.runInContext('timeLeft', context), 30);
  assert.equal(vm.runInContext('score', context), 0);
  assert.equal(frames.size, 1);
  const [id, tick] = frames.entries().next().value;
  frames.delete(id); tick(32000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext('phase', context), 'over');
  assert.equal(saves, 1);
  assert.equal(get('interrupt-btn').hidden, true);
});
