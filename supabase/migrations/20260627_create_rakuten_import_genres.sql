create table if not exists public.rakuten_import_genres (
  genre_id text primary key,
  genre_name text,
  genre_level integer,
  parent_genre_id text,
  item_count integer,
  is_leaf boolean,
  next_page integer not null default 1 check (next_page >= 1),
  completed_at timestamptz,
  children_discovered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rakuten_import_genres_pending_discovery_idx
  on public.rakuten_import_genres (children_discovered_at, genre_id);

create index if not exists rakuten_import_genres_pending_import_idx
  on public.rakuten_import_genres (completed_at, genre_id);

insert into public.rakuten_import_genres (
  genre_id,
  genre_name,
  genre_level
)
values ('001001', '漫画（コミック）', 2)
on conflict (genre_id) do nothing;

alter table public.rakuten_import_genres enable row level security;

-- Genre crawl state is operational data and remains server-only.
revoke all on table public.rakuten_import_genres from anon, authenticated;
grant all on table public.rakuten_import_genres to service_role;
