-- =====================================================================
-- Соревнования: отправки и таблица лидеров.
--   competition_submissions — журнал засчитанных отправок (для лимита «N за 24 часа»);
--   competition_entries     — лучший результат ученика и имя в таблице лидеров (по желанию).
-- Метрику считает серверная функция сайта по скрытым ответам и записывает результат служебным
-- ключом (service_role). Ученики не могут ни читать, ни менять эти таблицы напрямую: иначе любой
-- вписал бы себе лучший результат. Удаление аккаунта удаляет и эти строки (on delete cascade).
-- =====================================================================

create table if not exists public.competition_submissions (
  id bigint generated always as identity primary key,
  competition_id text not null check (char_length(competition_id) between 1 and 64),
  user_id uuid not null references auth.users (id) on delete cascade,
  mae numeric not null check (mae >= 0),
  median_ae numeric not null check (median_ae >= 0),
  created_at timestamptz not null default now()
);

create index if not exists competition_submissions_user_idx
  on public.competition_submissions (competition_id, user_id, created_at desc);

create table if not exists public.competition_entries (
  competition_id text not null check (char_length(competition_id) between 1 and 64),
  user_id uuid not null references auth.users (id) on delete cascade,
  nickname text check (nickname is null or char_length(nickname) between 2 and 24),
  best_mae numeric check (best_mae is null or best_mae >= 0),
  best_median_ae numeric,
  best_at timestamptz,
  submissions integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (competition_id, user_id)
);

create unique index if not exists competition_entries_nickname_idx
  on public.competition_entries (competition_id, lower(nickname)) where nickname is not null;
create index if not exists competition_entries_rank_idx
  on public.competition_entries (competition_id, best_mae) where best_mae is not null;

alter table public.competition_submissions enable row level security;
alter table public.competition_entries enable row level security;
-- политик нет: для anon и authenticated таблицы закрыты полностью, работает только service_role
revoke all on public.competition_submissions from anon, authenticated;
revoke all on public.competition_entries from anon, authenticated;

-- ---------------------------------------------------------------------
-- Засчитать отправку: журнал + лучший результат одним вызовом (атомарно).
-- Возвращает лучший результат ученика, число его отправок, место и число участников.
-- ---------------------------------------------------------------------
create or replace function public.record_competition_submission(
  p_competition text, p_user uuid, p_mae numeric, p_median_ae numeric
)
returns table (best_mae numeric, best_median_ae numeric, submissions integer, place bigint, participants bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.competition_entries%rowtype;
begin
  insert into public.competition_submissions (competition_id, user_id, mae, median_ae)
  values (p_competition, p_user, p_mae, p_median_ae);

  insert into public.competition_entries as ce (competition_id, user_id, best_mae, best_median_ae, best_at, submissions, updated_at)
  values (p_competition, p_user, p_mae, p_median_ae, now(), 1, now())
  on conflict (competition_id, user_id) do update set
    submissions = ce.submissions + 1,
    updated_at = now(),
    best_median_ae = case when ce.best_mae is null or excluded.best_mae < ce.best_mae then excluded.best_median_ae else ce.best_median_ae end,
    best_at = case when ce.best_mae is null or excluded.best_mae < ce.best_mae then now() else ce.best_at end,
    best_mae = case when ce.best_mae is null or excluded.best_mae < ce.best_mae then excluded.best_mae else ce.best_mae end
  returning * into e;

  return query
    select e.best_mae, e.best_median_ae, e.submissions,
           (select count(*) from public.competition_entries x
             where x.competition_id = p_competition and x.best_mae < e.best_mae) + 1,
           (select count(*) from public.competition_entries x
             where x.competition_id = p_competition and x.best_mae is not null);
end;
$$;

revoke execute on function public.record_competition_submission(text, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.record_competition_submission(text, uuid, numeric, numeric) to service_role;
