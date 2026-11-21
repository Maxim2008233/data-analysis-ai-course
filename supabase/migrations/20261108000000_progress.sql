-- =====================================================================
-- Прогресс учеников курса «Анализ данных и ИИ»
--   profiles  — служебные данные пользователя (эпоха прогресса для сброса на всех устройствах)
--   progress  — одна строка на задание / урок / соревнование: статус, код, попытки, подсказки…
-- Доступ: каждый пользователь видит и меняет только свои строки (Row Level Security).
-- Слияние: public.merge_progress — те же правила, что в src/lib/progress/merge.ts.
-- =====================================================================

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  progress_epoch integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 200),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 262144),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, item_key)
);

create index if not exists progress_user_updated_idx on public.progress (user_id, updated_at);

alter table public.profiles enable row level security;
alter table public.progress enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
drop policy if exists "profiles: insert own" on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles: insert own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles: update own" on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "progress: read own" on public.progress;
drop policy if exists "progress: insert own" on public.progress;
drop policy if exists "progress: update own" on public.progress;
drop policy if exists "progress: delete own" on public.progress;
create policy "progress: read own" on public.progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "progress: insert own" on public.progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "progress: update own" on public.progress
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "progress: delete own" on public.progress
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles from anon;
revoke all on public.progress from anon;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.progress to authenticated;

-- ---------------------------------------------------------------------
-- Слияние двух записей прогресса (коммутативно по смыслу: решённое не теряется)
-- ---------------------------------------------------------------------
create or replace function public.merge_progress(a jsonb, b jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  res jsonb := '{}'::jsonb;
  a_at numeric;
  b_at numeric;
  newer jsonb;
  older jsonb;
  k text;
  v jsonb;
  f text;
  ra int;
  rb int;
  va numeric;
  vb numeric;
  q jsonb;
  qk text;
  qv jsonb;
  lower_better boolean;
  handled text[] := array['status','code','codeAt','quiz','best','lowerIsBetter','at',
                          'attempts','fails','hints','submissions','solutionShown','theoryRead',
                          'solvedAt','theoryReadAt'];
begin
  if a is null or jsonb_typeof(a) <> 'object' then
    return coalesce(case when jsonb_typeof(b) = 'object' then b end, '{}'::jsonb);
  end if;
  if b is null or jsonb_typeof(b) <> 'object' then
    return a;
  end if;
  a_at := coalesce(case when jsonb_typeof(a->'at') = 'number' then (a->>'at')::numeric end, 0);
  b_at := coalesce(case when jsonb_typeof(b->'at') = 'number' then (b->>'at')::numeric end, 0);
  if b_at > a_at then newer := b; older := a; else newer := a; older := b; end if;

  -- прочие поля — из более свежей записи
  for k, v in select * from jsonb_each(older) loop
    if not (k = any(handled)) then res := res || jsonb_build_object(k, v); end if;
  end loop;
  for k, v in select * from jsonb_each(newer) loop
    if not (k = any(handled)) then res := res || jsonb_build_object(k, v); end if;
  end loop;

  -- статус: «сильнейший»
  if (a ? 'status') or (b ? 'status') then
    ra := case a->>'status' when 'solved' then 2 when 'in_progress' then 1 else 0 end;
    rb := case b->>'status' when 'solved' then 2 when 'in_progress' then 1 else 0 end;
    res := res || jsonb_build_object('status',
      case when ra >= rb then coalesce(a->>'status', 'not_started') else coalesce(b->>'status', 'not_started') end);
  end if;

  -- счётчики: максимум
  foreach f in array array['attempts','fails','hints','submissions'] loop
    va := case when jsonb_typeof(a->f) = 'number' then (a->>f)::numeric end;
    vb := case when jsonb_typeof(b->f) = 'number' then (b->>f)::numeric end;
    if va is not null or vb is not null then
      res := res || jsonb_build_object(f, greatest(coalesce(va, 0), coalesce(vb, 0)));
    end if;
  end loop;

  -- флаги: «или»
  foreach f in array array['solutionShown','theoryRead'] loop
    if (a ? f) or (b ? f) then
      res := res || jsonb_build_object(f,
        coalesce(case when jsonb_typeof(a->f) = 'boolean' then (a->>f)::boolean end, false)
        or coalesce(case when jsonb_typeof(b->f) = 'boolean' then (b->>f)::boolean end, false));
    end if;
  end loop;

  -- даты событий: самая ранняя
  foreach f in array array['solvedAt','theoryReadAt'] loop
    va := case when jsonb_typeof(a->f) = 'number' then (a->>f)::numeric end;
    vb := case when jsonb_typeof(b->f) = 'number' then (b->>f)::numeric end;
    if va is not null and vb is not null then
      res := res || jsonb_build_object(f, least(va, vb));
    elsif va is not null or vb is not null then
      res := res || jsonb_build_object(f, coalesce(va, vb));
    end if;
  end loop;

  -- код: более свежая версия
  if (a ? 'code') or (b ? 'code') then
    va := case when jsonb_typeof(a->'codeAt') = 'number' then (a->>'codeAt')::numeric end;
    vb := case when jsonb_typeof(b->'codeAt') = 'number' then (b->>'codeAt')::numeric end;
    if not (a ? 'code') or ((b ? 'code') and coalesce(vb, 0) > coalesce(va, 0)) then
      res := res || jsonb_build_object('code', b->'code');
      if vb is not null then res := res || jsonb_build_object('codeAt', vb); end if;
    else
      res := res || jsonb_build_object('code', a->'code');
      if va is not null then res := res || jsonb_build_object('codeAt', va); end if;
    end if;
  end if;

  -- квизы: по каждому вопросу более свежий ответ
  if (a ? 'quiz') or (b ? 'quiz') then
    q := case when jsonb_typeof(a->'quiz') = 'object' then a->'quiz' else '{}'::jsonb end;
    if jsonb_typeof(b->'quiz') = 'object' then
      for qk, qv in select * from jsonb_each(b->'quiz') loop
        if not (q ? qk)
           or coalesce(case when jsonb_typeof(qv->'at') = 'number' then (qv->>'at')::numeric end, 0)
              > coalesce(case when jsonb_typeof(q->qk->'at') = 'number' then (q->qk->>'at')::numeric end, 0) then
          q := q || jsonb_build_object(qk, qv);
        end if;
      end loop;
    end if;
    res := res || jsonb_build_object('quiz', q);
  end if;

  -- лучший результат соревнования
  lower_better := coalesce(
    case when jsonb_typeof(a->'lowerIsBetter') = 'boolean' then (a->>'lowerIsBetter')::boolean end,
    case when jsonb_typeof(b->'lowerIsBetter') = 'boolean' then (b->>'lowerIsBetter')::boolean end,
    false);
  va := case when jsonb_typeof(a->'best') = 'number' then (a->>'best')::numeric end;
  vb := case when jsonb_typeof(b->'best') = 'number' then (b->>'best')::numeric end;
  if va is not null or vb is not null then
    if va is null then res := res || jsonb_build_object('best', vb);
    elsif vb is null then res := res || jsonb_build_object('best', va);
    elsif lower_better then res := res || jsonb_build_object('best', least(va, vb));
    else res := res || jsonb_build_object('best', greatest(va, vb));
    end if;
  end if;
  if (a ? 'lowerIsBetter') or (b ? 'lowerIsBetter') then
    res := res || jsonb_build_object('lowerIsBetter', lower_better);
  end if;

  if a_at > 0 or b_at > 0 then
    res := res || jsonb_build_object('at', greatest(a_at, b_at));
  end if;
  return res;
end;
$$;

-- ---------------------------------------------------------------------
-- Синхронизация: принять пачку записей, слить с сохранёнными, вернуть результат
-- ---------------------------------------------------------------------
create or replace function public.sync_progress(p_items jsonb, p_epoch integer default 0)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cur_epoch integer;
  item jsonb;
  merged jsonb;
  out_items jsonb := '[]'::jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'too many items in one request (max 500)';
  end if;
  insert into public.profiles (user_id) values (uid) on conflict (user_id) do nothing;
  select progress_epoch into cur_epoch from public.profiles where user_id = uid;
  if coalesce(p_epoch, 0) < cur_epoch then
    -- прогресс сброшен на другом устройстве: клиент должен очистить локальный кэш
    return jsonb_build_object('stale', true, 'epoch', cur_epoch);
  end if;
  for item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item->'data') <> 'object' or coalesce(item->>'key', '') = '' then
      continue;
    end if;
    insert into public.progress as p (user_id, item_key, data, updated_at)
    values (uid, item->>'key', item->'data', clock_timestamp())
    on conflict (user_id, item_key) do update
      set data = public.merge_progress(p.data, excluded.data),
          updated_at = clock_timestamp()
    returning p.data into merged;
    out_items := out_items || jsonb_build_array(jsonb_build_object('key', item->>'key', 'data', merged));
  end loop;
  return jsonb_build_object('stale', false, 'epoch', cur_epoch, 'items', out_items);
end;
$$;

-- ---------------------------------------------------------------------
-- Сброс всего прогресса (эпоха растёт — остальные устройства очистят кэш)
-- ---------------------------------------------------------------------
create or replace function public.reset_progress()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_epoch integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.profiles (user_id) values (uid) on conflict (user_id) do nothing;
  delete from public.progress where user_id = uid;
  update public.profiles set progress_epoch = progress_epoch + 1 where user_id = uid
  returning progress_epoch into new_epoch;
  return new_epoch;
end;
$$;

-- ---------------------------------------------------------------------
-- Удаление собственного аккаунта вместе со всеми облачными данными
-- (security definer: только эта функция может удалить пользователя из auth.users, и только себя)
-- ---------------------------------------------------------------------
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.progress where user_id = uid;
  delete from public.profiles where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.sync_progress(jsonb, integer) from public, anon;
revoke execute on function public.reset_progress() from public, anon;
revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.sync_progress(jsonb, integer) to authenticated;
grant execute on function public.reset_progress() to authenticated;
grant execute on function public.delete_own_account() to authenticated;
grant execute on function public.merge_progress(jsonb, jsonb) to authenticated;
