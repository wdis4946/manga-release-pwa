create table if not exists public.madb_manga_series (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  normalized_title text
    generated always as (
      public.normalize_manga_title(title, false)
    ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists madb_manga_series_normalized_title_idx
  on public.madb_manga_series(normalized_title);
create unique index if not exists madb_manga_series_title_uidx
  on public.madb_manga_series(title);

alter table public.madb_manga_series enable row level security;

revoke all on table public.madb_manga_series
  from anon, authenticated;
grant all on table public.madb_manga_series
  to service_role;

insert into public.madb_manga_series (title)
select series.madb_title
from public.manga_series as series
order by series.madb_title
on conflict (title) do nothing;
