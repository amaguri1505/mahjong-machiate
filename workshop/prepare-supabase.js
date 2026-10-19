// ローカルに準備ファイルを生成するだけ。DB接続・作成・デプロイは行わない。
// node workshop/prepare-supabase.js <ペア数> <出力先ディレクトリ>
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { participantCode } = require('./participant-code');
const count = Number(process.argv[2]);
const output = process.argv[3];
const projectRef = process.argv[4] || 'REPLACE_WITH_WORKSHOP_PROJECT_REF';
const frontendOrigin = process.argv[5] || 'https://replace-with-workshop-frontend.invalid';
if (process.argv[4] && !/^[a-z]{20}$/.test(projectRef)) throw new Error('Project refの形式が不正です。');
const production = fs.readFileSync(path.join(__dirname, '..', 'online.js'), 'utf8').match(/https:\/\/([a-z]+)\.supabase\.co/);
if (production?.[1] === projectRef) throw new Error('通常版のプロジェクトには設定できません。');
const frontend = new URL(frontendOrigin);
if (frontend.origin !== frontendOrigin || (frontend.protocol !== 'https:' && frontendOrigin !== 'http://127.0.0.1:4173')) throw new Error('HTTPSオリジンまたはローカル演習URLを指定してください。');
if (!Number.isInteger(count) || count < 1 || count > 50 || !output) throw new Error('ペア数1〜50と、新規の出力先ディレクトリを指定してください。');
fs.mkdirSync(output, { mode: 0o700 });
const rand = () => randomBytes(24).toString('hex');
const labs = [];
let sql = `-- 演習専用の新規Supabaseプロジェクトのみで実行する。既存環境では実行しない。\nBEGIN;\nCREATE SEQUENCE public.workshop_profile_id_seq START WITH 101;\nREVOKE ALL ON SEQUENCE public.workshop_profile_id_seq FROM PUBLIC, anon, authenticated;\n`;
for (let i = 1; i <= count; i++) {
  const schema = `lab_${i}`;
  const reader = `${schema}_reader`, writer = `${schema}_writer`;
  const rp = rand(), wp = rand();
  sql += `
CREATE ROLE ${reader} LOGIN PASSWORD '${rp}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE ${writer} LOGIN PASSWORD '${wp}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA ${schema};
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ${schema} TO ${reader}, ${writer};
CREATE TABLE ${schema}.directory (id integer PRIMARY KEY, name text NOT NULL, published integer NOT NULL);
INSERT INTO ${schema}.directory VALUES (103,'ゲスト猫',1),(102,'ライバル猫',0),(104,'森の猫',0);
CREATE TABLE ${schema}.users (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, profile_id integer NOT NULL DEFAULT nextval('public.workshop_profile_id_seq') UNIQUE, participant_id text NOT NULL UNIQUE, name text NOT NULL, games jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ${schema}.state (participant_id text NOT NULL REFERENCES ${schema}.users(participant_id), mode text CHECK (mode IN ('vulnerable','fixed')), value jsonb NOT NULL, PRIMARY KEY (participant_id, mode));
CREATE TABLE ${schema}.sessions (id text PRIMARY KEY, participant_id text NOT NULL REFERENCES ${schema}.users(participant_id), expires_at timestamptz NOT NULL);
REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC, anon, authenticated;
GRANT SELECT ON ${schema}.directory TO ${reader};
GRANT SELECT, INSERT, UPDATE ON ${schema}.state TO ${writer};
GRANT SELECT, INSERT ON ${schema}.users TO ${writer};
GRANT UPDATE (games) ON ${schema}.users TO ${writer};
GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.sessions TO ${writer};
GRANT USAGE ON SEQUENCE public.workshop_profile_id_seq TO ${writer};
ALTER ROLE ${reader} SET statement_timeout = '1s';
ALTER ROLE ${reader} SET default_transaction_read_only = on;
ALTER ROLE ${reader} SET search_path = pg_catalog;
ALTER ROLE ${writer} SET search_path = pg_catalog;
`;
  let code;
  do { code = participantCode(i - 1); } while (labs.some(lab => lab.code === code));
  labs.push({ id: String(i), code, schema,
    readUrl: `postgresql://${reader}:${rp}@db.${projectRef}.supabase.co:5432/postgres`,
    writeUrl: `postgresql://${writer}:${wp}@db.${projectRef}.supabase.co:5432/postgres` });
}
sql += '\nCOMMIT;\n';
fs.writeFileSync(path.join(output, 'setup.sql'), sql, { mode: 0o600 });
fs.writeFileSync(path.join(output, 'secrets.env'), `WORKSHOP_ORIGIN=${frontendOrigin}\nWORKSHOP_SESSION_SECRET=${rand()}\nWORKSHOP_LABS=${JSON.stringify(labs)}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(output, 'participants.txt'), labs.map(l => `ペア${l.id}: ${l.code}`).join('\n'), { mode: 0o600 });
console.log('setup.sql / secrets.env / participants.txt を生成しました。秘密値は表示しません。DB操作は未実施です。');
