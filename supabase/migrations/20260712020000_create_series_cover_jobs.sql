create table if not exists public.series_cover_jobs (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 1,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id)
);

create index if not exists series_cover_jobs_status_created_at_idx
  on public.series_cover_jobs(status, created_at, id);

create index if not exists series_cover_jobs_series_id_idx
  on public.series_cover_jobs(series_id);
