create table if not exists public.manga_series_genres (
  series_id uuid not null
    references public.manga_series(id) on delete cascade,
  genre_id uuid not null
    references public.manga_genres(genre_id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint manga_series_genres_pkey primary key (series_id, genre_id)
);

create index if not exists manga_series_genres_genre_id_idx
  on public.manga_series_genres using btree (genre_id);

alter table public.manga_series_genres enable row level security;

revoke all on table public.manga_series_genres
  from anon, authenticated;
grant all on table public.manga_series_genres
  to service_role;
