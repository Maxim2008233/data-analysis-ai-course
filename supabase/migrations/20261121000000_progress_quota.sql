-- =====================================================================
-- Пределы прогресса одного пользователя: не больше 3000 записей и 10 МБ данных.
-- Курс использует около 1040 ключей (задания, уроки, соревнования) и обычно 1–3 МБ.
-- Без пределов один зарегистрированный аккаунт мог бы заполнить бесплатную базу (500 МБ):
-- 3000 записей по 256 КБ — это 768 МБ. Проверяет триггер до вставки и до изменения данных;
-- обновление уже существующей записи предел числа записей не задевает.
-- =====================================================================
create or replace function public.progress_quota()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  max_items constant integer := 3000;
  max_bytes constant bigint := 10 * 1024 * 1024;
  others bigint;
begin
  if tg_op = 'INSERT'
     and not exists (select 1 from public.progress where user_id = new.user_id and item_key = new.item_key)
     and (select count(*) from public.progress where user_id = new.user_id) >= max_items then
    raise exception 'progress quota: too many items (max %)', max_items using errcode = '54000';
  end if;
  select coalesce(sum(pg_column_size(p.data)), 0) into others
    from public.progress p
   where p.user_id = new.user_id and p.item_key <> new.item_key;
  if others + pg_column_size(new.data) > max_bytes then
    raise exception 'progress quota: too much data (max % bytes)', max_bytes using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists progress_quota on public.progress;
create trigger progress_quota
  before insert or update of data on public.progress
  for each row execute function public.progress_quota();
