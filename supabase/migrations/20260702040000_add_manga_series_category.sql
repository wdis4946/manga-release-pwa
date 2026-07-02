alter table public.manga_series
  add column if not exists category_number integer not null default 0,
  add column if not exists category_name text not null default 'default';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'manga_series_category_number_nonnegative'
      and conrelid = 'public.manga_series'::regclass
  ) then
    alter table public.manga_series
      add constraint manga_series_category_number_nonnegative
      check (category_number >= 0) not valid;
  end if;
end;
$$;

alter table public.manga_series
  validate constraint manga_series_category_number_nonnegative;

update public.manga_series
set
  category_number = coalesce(category_number, 0),
  category_name = coalesce(nullif(btrim(category_name), ''), 'default'),
  updated_at = now()
where category_number is null
   or category_name is null
   or btrim(category_name) = '';

alter table public.manga_series
  drop constraint if exists manga_series_search_title_key;

drop index if exists public.manga_series_search_title_key;

create unique index if not exists manga_series_search_title_category_number_key
  on public.manga_series(search_title, category_number);

create index if not exists manga_series_category_idx
  on public.manga_series(category_number, category_name);

drop function if exists public.find_similar_manga_series(text, integer);

create or replace function public.find_similar_manga_series(
  p_normalized_title text,
  p_limit integer default 3
)
returns table (
  id uuid,
  search_title text,
  display_title text,
  category_number integer,
  category_name text,
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
    series.category_number,
    series.category_name,
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
    series.category_number,
    series.id
  limit greatest(1, least(p_limit, 20));
$$;

revoke all on function public.find_similar_manga_series(text, integer)
  from public, anon, authenticated;
grant execute on function public.find_similar_manga_series(text, integer)
  to service_role;
