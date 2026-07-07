create or replace function public.list_admin_manga_series(
  p_query_text text default null,
  p_exclude_empty boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  search_title text,
  display_title text,
  item_count bigint,
  total_count bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with filtered_series as (
    select
      series.id,
      series.search_title,
      series.display_title,
      count(item.isbn) as item_count
    from public.manga_series as series
    left join public.manga_series_items as item
      on item.series_id = series.id
    where nullif(btrim(p_query_text), '') is null
      or series.display_title ilike '%' || btrim(p_query_text) || '%'
    group by
      series.id,
      series.search_title,
      series.display_title
    having not p_exclude_empty
      or count(item.isbn) > 0
  )
  select
    filtered.id,
    filtered.search_title,
    filtered.display_title,
    filtered.item_count,
    count(*) over () as total_count
  from filtered_series as filtered
  order by filtered.display_title asc, filtered.id asc
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;

revoke all on function public.list_admin_manga_series(text, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_admin_manga_series(text, boolean, integer, integer)
  to service_role;
