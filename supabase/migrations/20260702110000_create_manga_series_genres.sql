create table if not exists public.manga_series_genres (
  series_id uuid not null
    references public.manga_series(id) on delete cascade,
  genre_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (series_id, genre_name),
  constraint manga_series_genres_name_not_blank
    check (btrim(genre_name) <> ''),
  constraint manga_series_genres_sort_order_nonnegative
    check (sort_order >= 0)
);

create index if not exists manga_series_genres_series_sort_order_idx
  on public.manga_series_genres(series_id, sort_order, genre_name);

with wiki_genres as (
  select distinct on (series.id, btrim(genre.genre_name))
    series.id as series_id,
    btrim(genre.genre_name) as genre_name,
    genre.ordinality
  from public.wiki_manga_series as wiki
  join public.manga_series as series
    on public.normalize_manga_title(series.search_title, false) = wiki.normalized_title
  cross join lateral regexp_split_to_table(
    coalesce(wiki.genre, ''),
    '\s*,\s*'
  ) with ordinality as genre(genre_name, ordinality)
  where btrim(genre.genre_name) <> ''
  order by
    series.id,
    btrim(genre.genre_name),
    genre.ordinality
)
insert into public.manga_series_genres (
  series_id,
  genre_name,
  sort_order
)
select
  series_id,
  genre_name,
  row_number() over (
    partition by series_id
    order by ordinality, genre_name
  )::integer - 1 as sort_order
from wiki_genres
on conflict (series_id, genre_name)
do update set
  sort_order = excluded.sort_order;

alter table public.manga_series_genres enable row level security;

revoke all on table public.manga_series_genres
  from anon, authenticated;
grant all on table public.manga_series_genres
  to service_role;
