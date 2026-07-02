drop function if exists public.find_similar_manga_series(text, integer);

drop index if exists public.manga_series_search_title_category_number_key;
drop index if exists public.manga_series_category_idx;

alter table public.manga_series
  drop constraint if exists manga_series_category_number_nonnegative;

alter table public.manga_series
  drop column if exists category_number,
  drop column if exists category_name;

create or replace function public.find_similar_manga_series(
  p_normalized_title text,
  p_limit integer default 3
)
returns table (
  id uuid,
  search_title text,
  display_title text,
  similarity_score real
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    series.id,
    series.search_title,
    series.display_title,
    similarity(
      public.normalize_manga_title(series.search_title, false),
      public.normalize_manga_title(p_normalized_title, false)
    ) as similarity_score
  from public.manga_series as series
  where p_normalized_title is not null
    and btrim(p_normalized_title) <> ''
  order by
    public.normalize_manga_title(series.search_title, false)
      OPERATOR(extensions.<->)
    public.normalize_manga_title(p_normalized_title, false),
    series.display_title,
    series.id
  limit greatest(1, least(p_limit, 20));
$$;

revoke all on function public.find_similar_manga_series(text, integer)
  from public, anon, authenticated;
grant execute on function public.find_similar_manga_series(text, integer)
  to service_role;
