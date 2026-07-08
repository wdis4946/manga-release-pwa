-- シリーズ管理画面のカテゴリ移動で使うRPC関数を復旧するSQL。
-- Supabase SQL Editorで直接実行してください。

create or replace function public.reorder_series_items_category(
  p_series_id uuid,
  p_category_number integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reordered_count integer := 0;
begin
  update public.series_items as item
  set
    display_order = -1 - ordered.next_display_order,
    updated_at = now()
  from (
    select
      isbn,
      row_number() over (
        order by
          case
            when display_order < 0 then (-1 - display_order)
            else display_order
          end,
          isbn
      )::integer - 1 as next_display_order
    from public.series_items
    where series_id = p_series_id
      and category_number = p_category_number
  ) as ordered
  where item.series_id = p_series_id
    and item.category_number = p_category_number
    and item.isbn = ordered.isbn;

  update public.series_items as item
  set
    display_order = -1 - item.display_order,
    updated_at = now()
  where item.series_id = p_series_id
    and item.category_number = p_category_number
    and item.display_order < 0;

  get diagnostics v_reordered_count = row_count;

  return v_reordered_count;
end;
$$;

create or replace function public.move_series_items_to_category(
  p_series_id uuid,
  p_isbns text[],
  p_category_number integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_moved_count integer;
  v_category_number integer;
begin
  if p_category_number < 0 then
    raise exception 'Category number must be non-negative.';
  end if;

  if not exists (
    select 1
    from public.series_categories
    where series_id = p_series_id
      and category_number = p_category_number
  ) then
    raise exception 'Category was not found.';
  end if;

  create temporary table moved_item_categories on commit drop as
  select distinct category_number
  from public.series_items
  where series_id = p_series_id
    and isbn = any(p_isbns);

  create unique index moved_item_categories_category_number_key
    on moved_item_categories(category_number);

  -- 一意制約(series_id, category_number, display_order)にぶつからないよう、
  -- 先に移動対象を負の一時表示順へ逃がしてから移動先カテゴリに入れる。
  update public.series_items as item
  set
    display_order = -1000000 - escaped.row_number,
    updated_at = now()
  from (
    select
      isbn,
      row_number() over (order by display_order, isbn)::integer as row_number
    from public.series_items
    where series_id = p_series_id
      and isbn = any(p_isbns)
  ) as escaped
  where item.series_id = p_series_id
    and item.isbn = escaped.isbn;

  update public.series_items as item
  set
    category_number = p_category_number,
    display_order = -1 - destination_order.next_display_order,
    updated_at = now()
  from (
    select
      moved.isbn,
      coalesce(destination.max_display_order, -1)
        + row_number() over (
          order by
            case
              when moved.display_order < 0 then (-1000000 - moved.display_order)
              else moved.display_order
            end,
            moved.isbn
        )::integer as next_display_order
    from public.series_items as moved
    cross join (
      select max(display_order) as max_display_order
      from public.series_items
      where series_id = p_series_id
        and category_number = p_category_number
        and isbn <> all(p_isbns)
    ) as destination
    where moved.series_id = p_series_id
      and moved.isbn = any(p_isbns)
  ) as destination_order
  where item.series_id = p_series_id
    and item.isbn = destination_order.isbn;

  get diagnostics v_moved_count = row_count;

  insert into moved_item_categories(category_number)
  values (p_category_number)
  on conflict do nothing;

  for v_category_number in
    select category_number
    from moved_item_categories
  loop
    perform public.reorder_series_items_category(
      p_series_id,
      v_category_number
    );
  end loop;

  return v_moved_count;
end;
$$;

create or replace function public.update_series_item_display_orders(
  p_series_id uuid,
  p_item_orders jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated_count integer := 0;
  v_category_number integer;
begin
  create temporary table requested_item_orders on commit drop as
  select distinct on (isbn)
    btrim(isbn) as isbn,
    category_number,
    display_order
  from jsonb_to_recordset(coalesce(p_item_orders, '[]'::jsonb))
    as item_order(isbn text, category_number integer, display_order integer)
  where btrim(isbn) <> ''
  order by isbn;

  if exists (
    select 1
    from requested_item_orders
    where category_number < 0
      or display_order < 0
  ) then
    raise exception 'Category number and display order must be non-negative.';
  end if;

  if exists (
    select 1
    from requested_item_orders as requested
    where not exists (
      select 1
      from public.series_items as item
      where item.series_id = p_series_id
        and item.isbn = requested.isbn
    )
  ) then
    raise exception 'Item was not found in the series.';
  end if;

  if exists (
    select 1
    from requested_item_orders as requested
    where not exists (
      select 1
      from public.series_categories as category
      where category.series_id = p_series_id
        and category.category_number = requested.category_number
    )
  ) then
    raise exception 'Category was not found.';
  end if;

  create temporary table affected_item_categories on commit drop as
  select distinct item.category_number
  from public.series_items as item
  join requested_item_orders as requested
    on requested.isbn = item.isbn
  where item.series_id = p_series_id
  union
  select distinct category_number
  from requested_item_orders;

  update public.series_items as item
  set
    display_order = -1000000 - numbered.row_number,
    updated_at = now()
  from (
    select
      requested.isbn,
      row_number() over (order by requested.display_order, requested.isbn)::integer
        as row_number
    from requested_item_orders as requested
  ) as numbered
  where item.series_id = p_series_id
    and item.isbn = numbered.isbn;

  update public.series_items as item
  set
    category_number = requested.category_number,
    display_order = -1 - requested.display_order,
    updated_at = now()
  from requested_item_orders as requested
  where item.series_id = p_series_id
    and item.isbn = requested.isbn;

  get diagnostics v_updated_count = row_count;

  for v_category_number in
    select category_number
    from affected_item_categories
  loop
    perform public.reorder_series_items_category(
      p_series_id,
      v_category_number
    );
  end loop;

  return v_updated_count;
end;
$$;

revoke all on function public.move_series_items_to_category(uuid, text[], integer)
  from public, anon, authenticated;
grant execute on function public.move_series_items_to_category(uuid, text[], integer)
  to service_role;

revoke all on function public.reorder_series_items_category(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.reorder_series_items_category(uuid, integer)
  to service_role;

revoke all on function public.update_series_item_display_orders(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_series_item_display_orders(uuid, jsonb)
  to service_role;

select
  proname,
  pg_get_function_arguments(oid) as arguments,
  pg_get_function_result(oid) as result_type
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'move_series_items_to_category',
    'reorder_series_items_category',
    'update_series_item_display_orders'
  )
order by proname;
