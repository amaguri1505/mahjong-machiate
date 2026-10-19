// 弱点版では他ユーザーを含む保存名をHTMLとして扱う。修正版はtextContentで描画する。
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
  for (const row of [...event.data.rows, ...(event.data.preview ? [event.data.preview] : [])]) {
    const li = document.createElement('li');
    list.appendChild(li);
    const name = document.createElement('span');
    name.className = row.userId === event.data.me ? 'ranking-name mine' : 'ranking-name';
    if (row.sample) li.style.listStyle = 'none';
    if (fixed || !row.allowHtml) name.textContent = row.name;
    else name.innerHTML = row.name; // 意図した教材の保存型DOM XSS
    li.appendChild(name);
    if (!row.sample) {
      const score = document.createElement('span');
      score.className = row.userId === event.data.me ? 'ranking-score mine' : 'ranking-score';
      score.textContent = `${row.score}点`;
      li.appendChild(document.createTextNode(' — '));
      li.appendChild(score);
    }
  }
});
parent.postMessage({ type: 'ranking-ready' }, '*');
