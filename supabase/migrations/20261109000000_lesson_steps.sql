-- Урок состоит из шагов (как на Stepik): поле maxStep — самый дальний открытый шаг.
-- Сливается как максимум (то же правило в src/lib/progress/merge.ts).
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
                          'attempts','fails','hints','submissions','maxStep','solutionShown','theoryRead',
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
  foreach f in array array['attempts','fails','hints','submissions','maxStep'] loop
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

grant execute on function public.merge_progress(jsonb, jsonb) to authenticated;
