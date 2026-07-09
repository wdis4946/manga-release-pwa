create table if not exists public.series_summary_jobs (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  summary text,
  confidence text,
  needs_review boolean,
  notes text,
  source_urls text[] not null default '{}',
  error_message text,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint series_summary_jobs_series_id_key unique (series_id),
  constraint series_summary_jobs_status_check check (
    status in ('pending', 'processing', 'completed', 'needs_review', 'failed')
  ),
  constraint series_summary_jobs_attempts_nonnegative check (attempts >= 0),
  constraint series_summary_jobs_max_attempts_positive check (max_attempts > 0)
);

create index if not exists series_summary_jobs_status_created_at_idx
  on public.series_summary_jobs(status, created_at, id);

create index if not exists series_summary_jobs_series_id_idx
  on public.series_summary_jobs(series_id);

alter table public.series_summary_jobs enable row level security;

revoke all on table public.series_summary_jobs
  from anon, authenticated;
grant all on table public.series_summary_jobs
  to service_role;

create or replace function public.claim_series_summary_jobs(
  p_limit integer default 1,
  p_stale_after_minutes integer default 30
)
returns table (
  id uuid,
  series_id uuid,
  attempts integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select job.id
    from public.series_summary_jobs as job
    where job.attempts < job.max_attempts
      and (
        job.status = 'pending'
        or (
          job.status = 'processing'
          and job.locked_at < now() - make_interval(
            mins => greatest(1, p_stale_after_minutes)
          )
        )
      )
    order by job.created_at, job.id
    limit greatest(1, least(p_limit, 10))
    for update skip locked
  )
  update public.series_summary_jobs as job
  set
    status = 'processing',
    attempts = job.attempts + 1,
    locked_at = now(),
    started_at = coalesce(job.started_at, now()),
    updated_at = now(),
    error_message = null
  from candidates
  where job.id = candidates.id
  returning
    job.id,
    job.series_id,
    job.attempts,
    job.max_attempts;
end;
$$;

revoke all on function public.claim_series_summary_jobs(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_series_summary_jobs(integer, integer)
  to service_role;
