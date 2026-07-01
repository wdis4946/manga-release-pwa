create table if not exists public.madb_manga_items (
  isbn text primary key,
  title text not null,
  normalized_title text
    generated always as (
      public.normalize_manga_title(title, true)
    ) stored,
  authors text,
  publisher text,
  imprint text
);

create index if not exists madb_manga_items_normalized_title_idx
  on public.madb_manga_items(normalized_title);

alter table public.madb_manga_items enable row level security;

revoke all on table public.madb_manga_items
  from anon, authenticated;
grant all on table public.madb_manga_items
  to service_role;

alter table public.wiki_manga_series
  add column if not exists publisher text,
  add column if not exists genre text;
