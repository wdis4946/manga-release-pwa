alter table public.series_summary_jobs
  drop constraint if exists series_summary_jobs_status_check;

alter table public.series_summary_jobs
  add constraint series_summary_jobs_status_check check (
    status in (
      'pending',
      'sources_collected',
      'source_collection_failed',
      'processing',
      'completed',
      'needs_review',
      'failed'
    )
  );

drop index if exists series_summary_jobs_status_created_at_idx;
create index if not exists series_summary_jobs_status_created_at_idx
  on public.series_summary_jobs(status, created_at, id);

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
        job.status in ('pending', 'sources_collected')
        or (
          job.status = 'processing'
          and job.locked_at < now() - make_interval(
            mins => greatest(1, p_stale_after_minutes)
          )
        )
      )
    order by
      case
        when job.status = 'sources_collected' then 0
        else 1
      end,
      job.created_at,
      job.id
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
