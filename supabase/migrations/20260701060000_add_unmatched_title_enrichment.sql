create table if not exists public.openbd_manga_items (
  isbn text primary key,
  title text not null,
  normalized_title text
    generated always as (
      public.normalize_manga_title(title, true)
    ) stored,
  author text,
  publisher text,
  series text,
  publication_date text,
  cover_url text,
  raw_response jsonb not null,
  last_fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists openbd_manga_items_normalized_title_idx
  on public.openbd_manga_items(normalized_title);

alter table public.openbd_manga_items enable row level security;
revoke all on table public.openbd_manga_items from anon, authenticated;
grant all on table public.openbd_manga_items to service_role;

alter table public.manga_series_item_match_issues
  add column if not exists source_title text,
  add column if not exists title_source text,
  add column if not exists title_lookup_status text,
  add column if not exists title_lookup_at timestamptz;

alter table public.manga_series_item_match_issues
  drop constraint if exists manga_match_issues_title_lookup_status_check;

alter table public.manga_series_item_match_issues
  add constraint manga_match_issues_title_lookup_status_check
  check (
    title_lookup_status is null
    or title_lookup_status in ('found', 'not_found', 'error')
  );

create index if not exists manga_match_issues_title_lookup_queue_idx
  on public.manga_series_item_match_issues(
    is_resolved,
    issue_type,
    title_lookup_status,
    isbn
  );
