// 覚えやすい4文字の語と、見間違えにくいランダム5文字。全体で10文字。
const { randomInt } = require('node:crypto');
const words = ['neko', 'tile', 'sora', 'mori', 'hana', 'yuki'];
const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
function participantCode(index) {
  return words[index % words.length] + '-' + Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('');
}
module.exports = { participantCode };
