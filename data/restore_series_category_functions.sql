-- シリーズ管理画面のカテゴリ番号・カテゴリ名更新で使うRPC関数を復旧するSQL。
-- Supabase SQL Editorで直接実行してください。

create or replace function public.update_series_category(
  p_series_id uuid,
  p_category_number integer,
  p_new_category_number integer,
  p_category_name text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.series_categories%rowtype;
begin
  if p_category_number < 0 or p_new_category_number < 0 then
    raise exception 'Category number must be non-negative.';
  end if;

  if nullif(btrim(p_category_name), '') is null then
    raise exception 'Category name is required.';
  end if;

  select *
  into v_existing
  from public.series_categories
  where series_id = p_series_id
    and category_number = p_category_number
  for update;

  if not found then
    return false;
  end if;

  if p_category_number <> p_new_category_number
    and exists (
      select 1
      from public.series_categories
      where series_id = p_series_id
        and category_number = p_new_category_number
    )
  then
    raise exception 'Category number already exists.';
  end if;

  if p_category_number = p_new_category_number then
    update public.series_categories
    set
      category_name = btrim(p_category_name),
      updated_at = now()
    where series_id = p_series_id
      and category_number = p_category_number;

    return true;
  end if;

  insert into public.series_categories (
    series_id,
    category_number,
    category_name,
    created_at,
    updated_at
  )
  values (
    p_series_id,
    p_new_category_number,
    btrim(p_category_name),
    v_existing.created_at,
    now()
  );

  update public.series_items
  set
    category_number = p_new_category_number,
    updated_at = now()
  where series_id = p_series_id
    and category_number = p_category_number;

  delete from public.series_categories
  where series_id = p_series_id
    and category_number = p_category_number;

  return true;
end;
$$;

revoke all on function public.update_series_category(uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.update_series_category(uuid, integer, integer, text)
  to service_role;

select
  proname,
  pg_get_function_arguments(oid) as arguments,
  pg_get_function_result(oid) as result_type
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'update_series_category';
