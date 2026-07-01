create schema if not exists extensions;

create extension if not exists pg_trgm
  with schema extensions;

drop function if exists public.find_nearest_manga_series(text, integer);

create index if not exists manga_series_search_title_trgm_idx
  on public.manga_series
  using gist (
    (public.normalize_manga_title(search_title, false))
    extensions.gist_trgm_ops
  );

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
