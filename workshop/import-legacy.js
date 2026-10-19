// 管理者が退避した旧開発サーバーのJSONを、永続DBへ一度だけ取り込む。
// node workshop/import-legacy.js <退避JSON> <移行元の識別名>
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createWorkshop } = require('./server');
const [file, source, databaseFile] = process.argv.slice(2);
if (!file || !source) throw new Error('退避JSONと移行元識別名を指定してください。');
const records = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(records) || records.some(r => !Number.isSafeInteger(r.userId) || !r.states?.vulnerable || !r.states?.fixed || typeof r.token !== 'string')) throw new Error('退避データの形式が違います。');
const databasePath = databaseFile || path.join(__dirname, 'game.sqlite');
const app = createWorkshop({ databasePath }); app.close();
const db = new DatabaseSync(databasePath);
db.exec('CREATE TABLE IF NOT EXISTS legacy_imports (source TEXT NOT NULL, legacy_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES accounts(id), PRIMARY KEY(source, legacy_id))');
let imported = 0, plays = 0, sessions = 0;
db.exec('BEGIN IMMEDIATE');
try {
  const highWater = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'accounts'").get()?.seq || 100;
  let nextId = Math.max(highWater, ...records.map(r => r.userId)) + 1;
  for (const r of records) {
    const prior = db.prepare('SELECT user_id FROM legacy_imports WHERE source = ? AND legacy_id = ?').get(source, r.userId);
    let id = prior?.user_id;
    if (!id) {
      id = r.userId <= highWater ? nextId++ : r.userId;
      const states = structuredClone(r.states);
      const games = new Map();
      for (const state of Object.values(states)) {
        for (const p of state.games || []) if (p.id !== 'seed-self' && p.id !== 'seed-guest') games.set(p.id, { ...p, userId: id });
        state.userId = id; state.games = [];
      }
      db.prepare('INSERT INTO accounts (id, lab_id, name, states, games) VALUES (?, ?, ?, ?, ?)').run(id, r.labId, states.vulnerable.participantName || states.vulnerable.name, JSON.stringify(states), JSON.stringify([...games.values()]));
      db.prepare('INSERT INTO legacy_imports VALUES (?, ?, ?)').run(source, r.userId, id);
      imported++; plays += games.size;
    }
    const digest = createHash('sha256').update(r.token).digest('hex');
    db.prepare('INSERT OR IGNORE INTO sessions VALUES (?, ?, ?)').run(digest, id, r.expires);
    sessions++;
  }
  db.exec('COMMIT');
  console.log(JSON.stringify({ source, importedUsers: imported, importedPlays: plays, restoredSessions: sessions }));
} catch (error) { db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
