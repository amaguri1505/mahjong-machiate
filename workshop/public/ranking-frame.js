// このファイルだけが保存名をHTMLとして扱う。sandboxにallow-same-originを追加しない。
let ticket = null;
let fixed = true;
window.celebrate = function () {
  if (fixed || !ticket) return;
  const banner = document.createElement('div');
  banner.id = 'lab-confetti';
  banner.textContent = '🎉 XSSからDOMを追加できました！';
  document.body.appendChild(banner);
  parent.postMessage({ type: 'xss-proof', ticket }, '*');
};
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'ranking') return;
  ticket = event.data.ticket;
  fixed = event.data.fixed;
  const list = document.getElementById('rows');
  list.replaceChildren();
  document.getElementById('lab-confetti')?.remove();
  for (const row of event.data.rows) {
    const li = document.createElement('li');
    list.appendChild(li);
    if (fixed) li.textContent = `${row.name} — ${row.score}点`;
    else li.innerHTML = `${row.name} — ${row.score}点`; // 意図した教材の保存型DOM XSS
  }
});
parent.postMessage({ type: 'ranking-ready' }, '*');
