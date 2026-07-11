alter table public.series_summary_jobs
  add column if not exists openai_batch_id text,
  add column if not exists openai_input_file_id text,
  add column if not exists batch_submitted_at timestamptz;

alter table public.series_summary_jobs
  drop constraint if exists series_summary_jobs_status_check;

alter table public.series_summary_jobs
  add constraint series_summary_jobs_status_check check (
    status in (
      'pending',
      'sources_collected',
      'source_collection_failed',
      'batch_submitted',
      'processing',
      'completed',
      'needs_review',
      'failed'
    )
  );

create index if not exists series_summary_jobs_openai_batch_id_idx
  on public.series_summary_jobs(openai_batch_id)
  where openai_batch_id is not null;
