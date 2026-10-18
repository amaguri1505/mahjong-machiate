begin;
ALTER TABLE lab_1.users ADD COLUMN profile_id integer GENERATED ALWAYS AS IDENTITY (START WITH 101) UNIQUE;
GRANT USAGE ON SEQUENCE lab_1.users_profile_id_seq TO lab_1_writer;
ALTER TABLE lab_2.users ADD COLUMN profile_id integer GENERATED ALWAYS AS IDENTITY (START WITH 101) UNIQUE;
GRANT USAGE ON SEQUENCE lab_2.users_profile_id_seq TO lab_2_writer;
commit;