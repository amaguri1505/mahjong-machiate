BEGIN;
-- 新規IDは両グループ共通のシーケンスから採番。既存のID最大値より後を使う。
CREATE SEQUENCE public.workshop_profile_id_seq START WITH 101;
REVOKE ALL ON SEQUENCE public.workshop_profile_id_seq FROM PUBLIC, anon, authenticated;
SELECT setval('public.workshop_profile_id_seq', GREATEST(100,
  COALESCE((SELECT max(profile_id) FROM lab_1.users), 100),
  COALESCE((SELECT max(profile_id) FROM lab_2.users), 100)), true);
ALTER TABLE lab_1.users ALTER COLUMN profile_id DROP IDENTITY;
ALTER TABLE lab_2.users ALTER COLUMN profile_id DROP IDENTITY;
ALTER TABLE lab_1.users ALTER COLUMN profile_id SET DEFAULT nextval('public.workshop_profile_id_seq');
ALTER TABLE lab_2.users ALTER COLUMN profile_id SET DEFAULT nextval('public.workshop_profile_id_seq');
UPDATE lab_2.users SET profile_id = nextval('public.workshop_profile_id_seq')
WHERE profile_id IN (SELECT profile_id FROM lab_1.users);
GRANT USAGE ON SEQUENCE public.workshop_profile_id_seq TO lab_1_writer, lab_2_writer;
DO $$
DECLARE schema_name text;
BEGIN
  FOREACH schema_name IN ARRAY ARRAY['lab_1', 'lab_2'] LOOP
    EXECUTE format('ALTER TABLE %I.users ADD COLUMN games jsonb NOT NULL DEFAULT ''[]''::jsonb', schema_name);
    -- 両モードの実プレイを統合し、同じプレイIDは一度だけ残す。
    EXECUTE format($sql$
      UPDATE %1$I.users u SET games = COALESCE((
        SELECT jsonb_agg(play ORDER BY (play->>'at')::bigint) FROM (
          SELECT DISTINCT ON (p->>'id') jsonb_set(p, '{userId}', to_jsonb(u.profile_id)) AS play
          FROM %1$I.state s CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.value->'games', '[]'::jsonb)) p
          WHERE s.participant_id = u.participant_id AND p->>'id' NOT IN ('seed-self', 'seed-guest')
          ORDER BY p->>'id'
        ) records
      ), '[]'::jsonb)
    $sql$, schema_name);
    EXECUTE format('CREATE TABLE %I.sessions (id text PRIMARY KEY, participant_id text NOT NULL REFERENCES %I.users(participant_id), expires_at timestamptz NOT NULL)', schema_name, schema_name);
    EXECUTE format('REVOKE ALL ON %I.sessions FROM PUBLIC, anon, authenticated', schema_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.sessions TO %I', schema_name, schema_name || '_writer');
    EXECUTE format('GRANT UPDATE (games) ON %I.users TO %I', schema_name, schema_name || '_writer');
  END LOOP;
END $$;
COMMIT;
