create table if not exists public.wiki_manga_series (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  normalized_title text
    generated always as (
      public.normalize_manga_title(title, false)
    ) stored,
  authors text,
  authors_wiki_url text,
  publisher text,
  imprint text,
  genre text,
  items text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wiki_manga_series_normalized_title_idx
  on public.wiki_manga_series(normalized_title);

alter table public.wiki_manga_series enable row level security;

revoke all on table public.wiki_manga_series
  from anon, authenticated;
grant all on table public.wiki_manga_series
  to service_role;
