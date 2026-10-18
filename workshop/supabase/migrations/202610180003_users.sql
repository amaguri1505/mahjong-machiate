begin;
CREATE TABLE IF NOT EXISTS lab_1.users (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, participant_id text NOT NULL UNIQUE, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON lab_1.users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON lab_1.users TO lab_1_writer;
INSERT INTO lab_1.users (participant_id, name)
SELECT DISTINCT ON (participant_id) participant_id, COALESCE(value->>'participantName', value->>'name', 'あなた') FROM lab_1.state ORDER BY participant_id, mode DESC
ON CONFLICT (participant_id) DO NOTHING;
ALTER TABLE lab_1.state ADD CONSTRAINT state_user_fk FOREIGN KEY (participant_id) REFERENCES lab_1.users (participant_id);
CREATE TABLE IF NOT EXISTS lab_2.users (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, participant_id text NOT NULL UNIQUE, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON lab_2.users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON lab_2.users TO lab_2_writer;
INSERT INTO lab_2.users (participant_id, name)
SELECT DISTINCT ON (participant_id) participant_id, COALESCE(value->>'participantName', value->>'name', 'あなた') FROM lab_2.state ORDER BY participant_id, mode DESC
ON CONFLICT (participant_id) DO NOTHING;
ALTER TABLE lab_2.state ADD CONSTRAINT state_user_fk FOREIGN KEY (participant_id) REFERENCES lab_2.users (participant_id);
commit;
