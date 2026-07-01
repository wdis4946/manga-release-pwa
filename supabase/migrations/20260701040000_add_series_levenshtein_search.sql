create schema if not exists extensions;

create extension if not exists fuzzystrmatch
  with schema extensions;

create or replace function public.find_nearest_manga_series(
  p_normalized_title text,
  p_limit integer default 3
)
returns table (
  id uuid,
  search_title text,
  display_title text,
  levenshtein_distance integer
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with normalized_input as (
    select left(
      public.normalize_manga_title(p_normalized_title, false),
      255
    ) as title
  )
  select
    series.id,
    series.search_title,
    series.display_title,
    levenshtein(
      left(
        public.normalize_manga_title(series.search_title, false),
        255
      ),
      input.title
    ) as levenshtein_distance
  from public.manga_series as series
  cross join normalized_input as input
  where p_normalized_title is not null
    and btrim(p_normalized_title) <> ''
  order by
    levenshtein_distance,
    series.display_title,
    series.id
  limit greatest(1, least(p_limit, 20));
$$;

revoke all on function public.find_nearest_manga_series(text, integer)
  from public, anon, authenticated;
grant execute on function public.find_nearest_manga_series(text, integer)
  to service_role;
