-- 麻雀 待ち当て：Supabase の表とアクセスルール。
-- Supabase の管理画面 → SQL Editor に全文を貼り付けて Run する。何度実行しても同じ状態になる書き方にしてある。

-- ---- 表 ----

-- プレイヤーの表示名（ランキングに出る名前）。auth.users と1対1。
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 12),
  created_at timestamptz not null default now()
);

-- 1回のプレイの記録。ランキングとマイページの両方がこの表を読む。
-- user_id はログイン中の本人で自動的に埋まり、他人の名前では書き込めない。
create table if not exists public.plays (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  score integer not null,
  solved integer not null,
  answered integer not null,
  best_streak integer not null,
  created_at timestamptz not null default now(),
  -- 明らかにおかしな値をはじく（1問の最高は子のツモ役満の複合でも 128,000 点未満）
  constraint plays_values_check check (
    solved >= 0
    and answered between solved and 300
    and best_streak between 0 and solved
    and score between 0 and solved * 128000
  )
);

create index if not exists plays_score_idx on public.plays (score desc, created_at);
create index if not exists plays_user_idx on public.plays (user_id, created_at desc);

-- ---- 新規登録したらプロフィールを作る ----

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- new のすぐ後ろに .id と書くと、チャット画面でURLと見なされてコピー時に壊れることがあるので括弧で囲む
  name text := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 12);
begin
  insert into public.profiles (id, display_name)
  values ((new).id, coalesce(nullif(name, ''), '名無し'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- アクセスルール（RLS） ----
-- 読む: 誰でも（ランキングを見るため）。
-- 書く: ログインした本人の分だけ。プレイ記録は追加のみで、書き換え・削除はできない。

alter table public.profiles enable row level security;
alter table public.plays enable row level security;

revoke all on public.profiles, public.plays from anon, authenticated;
grant select on public.profiles, public.plays to anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
grant insert (score, solved, answered, best_streak) on public.plays to authenticated;

drop policy if exists "profiles: 誰でも読める" on public.profiles;
create policy "profiles: 誰でも読める" on public.profiles
  for select using (true);

drop policy if exists "profiles: 本人だけ表示名を変えられる" on public.profiles;
create policy "profiles: 本人だけ表示名を変えられる" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "plays: 誰でも読める" on public.plays;
create policy "plays: 誰でも読める" on public.plays
  for select using (true);

drop policy if exists "plays: 本人の記録だけ追加できる" on public.plays;
create policy "plays: 本人の記録だけ追加できる" on public.plays
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
