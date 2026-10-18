begin;
alter table lab_1.state add column if not exists participant_id text not null default 'legacy';
alter table lab_1.state drop constraint state_pkey;
alter table lab_1.state add primary key (participant_id, mode);
alter table lab_2.state add column if not exists participant_id text not null default 'legacy';
alter table lab_2.state drop constraint state_pkey;
alter table lab_2.state add primary key (participant_id, mode);
commit;
