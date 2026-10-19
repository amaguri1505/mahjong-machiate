const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function page(logoutResponse) {
  const elements = new Map();
  function element() {
    return { hidden: true, value: '', disabled: false, handlers: {},
      contentWindow: { postMessage() {} }, append() {}, replaceChildren() {}, setAttribute() {},
      querySelector() { return this.button ||= element(); },
      addEventListener(name, handler) { this.handlers[name] = handler; }
    };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const storage = new Map([['workshop-token:/api', 'old-token']]);
  const calls = [];
  const window = { WORKSHOP_API: '/api', MahjongLogic: {}, handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; } };
  const context = vm.createContext({ window, TextEncoder, btoa, AbortSignal, location: { origin: 'http://localhost' },
    document: { getElementById: get, createElement: element, createTextNode: text => text, body: element(), querySelectorAll: () => [] },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    MutationObserver: class { observe() {} }, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === '/api/logout') return logoutResponse();
      return { ok: true, status: 200, json: async () => url.endsWith('/status') ? { me: 101, generation: 'generation' } : { name: '本人' } };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8'), context);
  return { get, storage, window, calls };
}

for (const [name, response] of [
  ['正常', () => ({ ok: true, status: 200, json: async () => ({ loggedOut: true }) })],
  ['期限切れ', () => ({ ok: false, status: 401, json: async () => ({ error: 'ログインしてください。' }) })],
  ['旧サーバー', () => ({ ok: false, status: 404, json: async () => ({ error: 'APIが見つかりません。' }) })],
  ['通信エラー', () => { throw new TypeError('Failed to fetch'); }]
]) test(`ログアウト画面: ${name}でも端末のセッションを破棄して参加画面へ戻る`, async () => {
  const p = page(response);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.window.Account.current().id, 101);
  assert.equal(p.get('entry').hidden, true);
  await p.get('logout-btn').handlers.click({ preventDefault() {} });
  assert.equal(p.window.Account.current(), null);
  assert.equal(p.storage.has('workshop-token:/api'), false);
  assert.equal(p.get('entry').hidden, false);
  assert.equal(p.get('mypage-overlay').hidden, true);
  assert.equal(p.calls.at(-1).options.headers.Authorization, 'Bearer old-token');
});

test('ログアウト画面: プレイ中・サーバー応答待ちでも参加画面へ戻れる', async () => {
  let finish;
  const p = page(() => new Promise(resolve => { finish = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  p.get('start-btn').handlers.click();
  assert.equal(p.get('logout-btn').disabled, false);
  const pending = p.get('logout-btn').handlers.click({ preventDefault() {} });
  assert.equal(p.window.Account.current(), null);
  assert.equal(p.get('entry').hidden, false);
  finish({ ok: true, json: async () => ({ loggedOut: true }) });
  await pending;
});

test('時間切れランキング: iframe準備後の再取得でも本人IDを渡す', async () => {
  const p = page(() => ({ ok: true, json: async () => ({}) }));
  await new Promise(resolve => setImmediate(resolve));
  const frame = p.get('ranking-frame').contentWindow;
  const messages = [];
  frame.postMessage = data => messages.push(data);
  await p.window.handlers.message({ source: frame, origin: 'http://localhost', data: { type: 'ranking-ready' }, preventDefault() {} });
  p.get('end-overlay').hidden = false;
  await p.window.Online.topPlays();
  assert.equal(messages.at(-1).type, 'ranking');
  assert.equal(messages.at(-1).me, 101);
  await p.window.Online.topPlays();
  assert.equal(messages.at(-1).me, 101);
});
