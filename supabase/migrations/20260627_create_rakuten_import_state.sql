create table if not exists public.rakuten_import_state (
  job_name text primary key,
  next_page integer not null default 1 check (next_page >= 1),
  cycle_number integer not null default 1 check (cycle_number >= 1),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rakuten_import_state enable row level security;

-- Import cursors are operational data and are only accessible to the batch.
revoke all on table public.rakuten_import_state from anon, authenticated;
grant all on table public.rakuten_import_state to service_role;
