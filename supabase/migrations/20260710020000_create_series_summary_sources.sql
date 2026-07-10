create table if not exists public.series_summary_sources (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  url text not null,
  domain text not null,
  source_type text not null default 'other',
  title text,
  description text,
  extracted_text text,
  score integer not null default 0,
  status text not null default 'pending',
  error_message text,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint series_summary_sources_series_url_key unique (series_id, url),
  constraint series_summary_sources_score_nonnegative check (score >= 0),
  constraint series_summary_sources_status_check check (
    status in ('pending', 'fetched', 'failed', 'ignored')
  ),
  constraint series_summary_sources_source_type_check check (
    source_type in (
      'publisher_official',
      'official_site',
      'bibliographic',
      'ebook_store',
      'reference_database',
      'other'
    )
  )
);

create index if not exists series_summary_sources_series_score_idx
  on public.series_summary_sources(series_id, status, score desc, id);

create index if not exists series_summary_sources_domain_idx
  on public.series_summary_sources(domain);

alter table public.series_summary_sources enable row level security;

revoke all on table public.series_summary_sources
  from anon, authenticated;
grant all on table public.series_summary_sources
  to service_role;
