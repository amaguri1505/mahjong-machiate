// 筒子・索子の絵柄を SVG で描く。座標は牌の面を 30×40 とした値。
// 色は CSS 変数（--pin / --sou / --man / --ivory）をクラス経由で使うので、style.css の配色に従う。
(function (root) {
  const B = "c-b"; // 青
  const G = "c-g"; // 緑
  const R = "c-r"; // 赤

  // 筒子の丸: 外輪・白抜き・芯の3重円
  function circle(cx, cy, r, color) {
    return (
      `<circle cx="${cx}" cy="${cy}" r="${r}" class="${color}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${(r * 0.66).toFixed(2)}" class="c-w"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${(r * 0.36).toFixed(2)}" class="${color}"/>`
    );
  }

  // 索子の竹: 縦長の棒に節を2本入れる。rot は時計回りの傾き（度）
  function stick(cx, cy, h, color, rot = 0) {
    const w = 3.4;
    const top = cy - h / 2;
    const transform = rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : "";
    return (
      `<g${transform}>` +
      `<rect x="${cx - w / 2}" y="${top}" width="${w}" height="${h}" rx="1.5" class="${color}"/>` +
      `<line x1="${cx - w / 2}" x2="${cx + w / 2}" y1="${top + h * 0.33}" y2="${top + h * 0.33}" class="node"/>` +
      `<line x1="${cx - w / 2}" x2="${cx + w / 2}" y1="${top + h * 0.66}" y2="${top + h * 0.66}" class="node"/>` +
      `</g>`
    );
  }

  const PIN = [
    // 1筒: 大きな飾り円
    () =>
      `<circle cx="15" cy="20" r="12" class="${G}"/>` +
      `<circle cx="15" cy="20" r="10" class="c-w"/>` +
      `<circle cx="15" cy="20" r="8.4" class="${B}"/>` +
      `<circle cx="15" cy="20" r="6.2" class="c-w"/>` +
      `<circle cx="15" cy="20" r="4.4" class="${R}"/>` +
      `<circle cx="15" cy="20" r="1.8" class="c-w"/>`,
    () => circle(15, 11, 6.5, G) + circle(15, 29, 6.5, B),
    () => circle(8, 9, 5.5, B) + circle(15, 20, 5.5, R) + circle(22, 31, 5.5, G),
    () => circle(9, 11, 5.8, B) + circle(21, 11, 5.8, G) + circle(9, 29, 5.8, G) + circle(21, 29, 5.8, B),
    () =>
      circle(8.5, 9.5, 5, B) + circle(21.5, 9.5, 5, G) + circle(15, 20, 5, R) +
      circle(8.5, 30.5, 5, G) + circle(21.5, 30.5, 5, B),
    () =>
      circle(9, 8, 4.6, G) + circle(21, 8, 4.6, G) +
      circle(9, 21, 4.6, R) + circle(21, 21, 4.6, R) + circle(9, 32, 4.6, R) + circle(21, 32, 4.6, R),
    () =>
      circle(7, 6.5, 4, G) + circle(15, 10.5, 4, G) + circle(23, 14.5, 4, G) +
      circle(9, 24, 4.4, R) + circle(21, 24, 4.4, R) + circle(9, 33.5, 4.4, R) + circle(21, 33.5, 4.4, R),
    () =>
      [7, 15.7, 24.3, 33].map((y) => circle(9, y, 4.2, B) + circle(21, y, 4.2, B)).join(""),
    () =>
      [
        [9, B],
        [20, R],
        [31, G],
      ]
        .map(([y, c]) => circle(7.5, y, 3.9, c) + circle(15, y, 3.9, c) + circle(22.5, y, 3.9, c))
        .join(""),
  ];

  const SOU = [
    // 1索: 鳥（孔雀）
    () =>
      `<ellipse cx="9" cy="27" rx="3" ry="8" class="${B}" transform="rotate(-28 9 27)"/>` +
      `<ellipse cx="15" cy="29" rx="3" ry="8" class="${G}"/>` +
      `<ellipse cx="21" cy="27" rx="3" ry="8" class="${B}" transform="rotate(28 21 27)"/>` +
      `<ellipse cx="15" cy="19" rx="5.5" ry="7.5" class="${G}"/>` +
      `<circle cx="15" cy="9.5" r="3.8" class="${G}"/>` +
      `<polygon points="18,8.5 22.5,10 18,11.5" class="${R}"/>` +
      `<circle cx="15.8" cy="8.8" r="0.9" class="c-w"/>` +
      `<path d="M13 6.2 L11.5 2.5 M15 5.8 L15 2 M17 6.2 L18.5 2.5" class="crest"/>`,
    () => stick(15, 11, 13, G) + stick(15, 29, 13, G),
    () => stick(15, 11, 13, G) + stick(9.5, 29, 13, G) + stick(20.5, 29, 13, G),
    () => stick(9.5, 11, 13, G) + stick(20.5, 11, 13, G) + stick(9.5, 29, 13, G) + stick(20.5, 29, 13, G),
    () =>
      stick(7.5, 11, 13, G) + stick(22.5, 11, 13, G) + stick(15, 20, 13, R) +
      stick(7.5, 29, 13, G) + stick(22.5, 29, 13, G),
    () => [11, 29].map((y) => stick(7.5, y, 13, G) + stick(15, y, 13, G) + stick(22.5, y, 13, G)).join(""),
    () =>
      stick(15, 7.5, 10, R) +
      [20, 32].map((y) => stick(7.5, y, 10, G) + stick(15, y, 10, G) + stick(22.5, y, 10, G)).join(""),
    // 8索: 上段は M、下段は W の形
    () =>
      [6, 12, 18, 24].map((x, i) => stick(x, 11, 13, G, i % 2 === 0 ? 18 : -18)).join("") +
      [6, 12, 18, 24].map((x, i) => stick(x, 29, 13, G, i % 2 === 0 ? -18 : 18)).join(""),
    () =>
      [8, 20, 32]
        .map((y) => stick(7.5, y, 10, G) + stick(15, y, 10, R) + stick(22.5, y, 10, G))
        .join(""),
  ];

  // 筒子・索子の牌番号から SVG 文字列を返す。それ以外は null。
  function tileArt(t) {
    const suit = Math.floor(t / 9);
    const draw = suit === 1 ? PIN[t % 9] : suit === 2 ? SOU[t % 9] : null;
    if (!draw || t >= 27) return null;
    return `<svg class="art" viewBox="0 0 30 40" aria-hidden="true" focusable="false">${draw()}</svg>`;
  }

  root.TileArt = { tileArt };
})(this);
