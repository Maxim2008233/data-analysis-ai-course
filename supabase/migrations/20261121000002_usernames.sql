-- =====================================================================
-- Логины учеников.
--   profiles.username — уникальный без учёта регистра; латиница: 3–20 символов (буквы, цифры, «_», «.», «-»),
--   начинается с буквы. Его видит ученик в углу экрана, а все — в таблице лидеров соревнований.
--   Регистрация: логин приходит в метаданных (signUp → options.data.username), триггер на auth.users
--   создаёт профиль с логином; занятый или неверный логин отменяет регистрацию.
--   username_available — свободен ли логин (для формы регистрации).
--   login_email — вход по логину: почта возвращается только при верном пароле; после 10 неудачных
--   попыток за 15 минут вход по этому логину приостанавливается (вход по почте работает как обычно).
--   Аккаунты, созданные до логинов, задают логин в профиле (обновление своей строки profiles по RLS).
-- =====================================================================

alter table public.profiles add column if not exists username text;
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[A-Za-z][A-Za-z0-9_.-]{2,19}$');
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

-- сервер сайта показывает логины в таблице лидеров (ученикам чужие профили по-прежнему не видны)
grant select on public.profiles to service_role;

-- ---------------------------------------------------------------------
-- Регистрация: профиль с логином из метаданных
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := nullif(btrim(new.raw_user_meta_data->>'username'), '');
begin
  if wanted is not null and wanted !~ '^[A-Za-z][A-Za-z0-9_.-]{2,19}$' then
    raise exception 'username invalid' using errcode = '23514';
  end if;
  insert into public.profiles (user_id, username) values (new.id, wanted)
  on conflict (user_id) do update set username = coalesce(public.profiles.username, excluded.username);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Свободен ли логин
-- ---------------------------------------------------------------------
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_username, '') ~ '^[A-Za-z][A-Za-z0-9_.-]{2,19}$'
     and not exists (select 1 from public.profiles where lower(username) = lower(p_username));
$$;

revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Вход по логину: почта — только при верном пароле, ограничение неудачных попыток
-- ---------------------------------------------------------------------
create table if not exists public.login_attempts (
  login text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_login_at_idx on public.login_attempts (login, at);
alter table public.login_attempts enable row level security;
-- политик нет: таблицу читает и пишет только функция login_email
revoke all on public.login_attempts from anon, authenticated;

create or replace function public.login_email(p_login text, p_password text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  key text := lower(btrim(coalesce(p_login, '')));
  failures integer;
  uid uuid;
  mail text;
  hash text;
begin
  -- ошибки не бросаем: иначе текст запроса мог бы попасть в журнал базы
  if key !~ '^[a-z][a-z0-9_.-]{2,19}$' or coalesce(p_password, '') = '' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select u.id, u.email, u.encrypted_password into uid, mail, hash
    from public.profiles p join auth.users u on u.id = p.user_id
   where lower(p.username) = key;
  if uid is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  delete from public.login_attempts where login = key and at < now() - interval '1 day';
  select count(*) into failures from public.login_attempts where login = key and at > now() - interval '15 minutes';
  if failures >= 10 then
    return jsonb_build_object('status', 'locked');
  end if;
  if coalesce(hash, '') = '' or extensions.crypt(p_password, hash) <> hash then
    insert into public.login_attempts (login) values (key);
    return jsonb_build_object('status', 'invalid');
  end if;
  delete from public.login_attempts where login = key;
  return jsonb_build_object('status', 'ok', 'email', mail);
end;
$$;

revoke execute on function public.login_email(text, text) from public;
grant execute on function public.login_email(text, text) to anon, authenticated;
