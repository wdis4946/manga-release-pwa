-- This is the replacement baseline migration. Back up manga_series before
-- applying it because it intentionally removes all application tables.
drop table if exists public.manga_series_item_unlink_logs cascade;
drop table if exists public.manga_series_item_match_issues cascade;
drop table if exists public.manga_series_items cascade;
drop table if exists public.rakuten_manga_item_details cascade;
drop table if exists public.rakuten_manga_items cascade;
drop table if exists public.rakuten_import_locks cascade;
drop table if exists public.rakuten_import_genres cascade;
drop table if exists public.rakuten_import_state cascade;
drop table if exists public.manga_series cascade;

create or replace function public.normalize_manga_title(
  input_title text,
  remove_volume_suffix boolean default false
)
returns text
language plpgsql
immutable
strict
as $$
declare
  normalized text;
  without_new_edition text;
  stripped text;
begin
  normalized := lower(
    btrim(
      regexp_replace(
        replace(normalize(input_title, NFKC), '　', ' '),
        '[[:space:]]+',
        ' ',
        'g'
      )
    )
  );

  if not remove_volume_suffix then
    return normalized;
  end if;

  without_new_edition := btrim(
    regexp_replace(normalized, '[[:space:]]*新版$', '', 'g')
  );
  without_new_edition := coalesce(
    nullif(without_new_edition, ''),
    normalized
  );

  stripped := btrim(
    regexp_replace(
      without_new_edition,
      '[[:space:]]*(第[[:space:]]*[0-9]+[[:space:]]*巻|[(][[:space:]]*[0-9]+[[:space:]]*[)]|vol[.]?[[:space:]]*[0-9]+|[0-9]+[[:space:]]*巻|[0-9]+)$',
      '',
      'i'
    )
  );

  return coalesce(nullif(stripped, ''), without_new_edition);
end;
$$;

create table public.manga_series (
  id uuid primary key default gen_random_uuid(),
  madb_title text not null unique,
  normalized_madb_title text
    generated always as (
      public.normalize_manga_title(madb_title, false)
    ) stored,
  display_title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rakuten_manga_items (
  isbn text primary key,
  title text not null,
  normalized_title text
    generated always as (public.normalize_manga_title(title, true)) stored,
  first_fetched_at timestamptz not null default now(),
  last_fetched_at timestamptz not null default now()
);

create table public.rakuten_manga_item_details (
  isbn text primary key
    references public.rakuten_manga_items(isbn) on delete cascade,
  title_kana text,
  sub_title text,
  sub_title_kana text,
  series_name text,
  series_name_kana text,
  contents text,
  contents_kana text,
  author text,
  author_kana text,
  publisher_name text,
  book_size text,
  item_caption text,
  sales_date text,
  item_price integer,
  item_url text,
  affiliate_url text,
  small_image_url text,
  medium_image_url text,
  large_image_url text,
  chirayomi_url text,
  availability integer,
  postage_flag integer,
  limited_flag integer,
  review_count integer,
  review_average numeric,
  books_genre_id text,
  raw_response jsonb,
  last_fetched_at timestamptz not null default now()
);

create table public.rakuten_import_genres (
  genre_id text primary key,
  genre_name text,
  genre_level integer,
  parent_genre_id text
    references public.rakuten_import_genres(genre_id) on delete cascade,
  item_count integer,
  is_leaf boolean,
  next_page integer not null default 1 check (next_page >= 1),
  completed_at timestamptz,
  children_discovered_at timestamptz,
  daily_cycle_date date,
  daily_next_page integer not null default 1
    check (daily_next_page >= 1),
  daily_empty_page_count integer not null default 0
    check (daily_empty_page_count >= 0),
  last_daily_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rakuten_import_locks (
  lock_name text primary key,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.manga_series_items (
  isbn text primary key
    references public.rakuten_manga_items(isbn) on delete cascade,
  series_id uuid not null
    references public.manga_series(id) on delete cascade,
  match_method text not null,
  matched_by uuid references auth.users(id) on delete set null,
  matched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.manga_series_item_match_issues (
  isbn text primary key
    references public.rakuten_manga_items(isbn) on delete cascade,
  normalized_title text not null,
  issue_type text not null
    check (issue_type in ('unmatched', 'ambiguous')),
  candidate_count integer not null default 0,
  candidate_series_ids uuid[] not null default '{}',
  is_resolved boolean not null default false,
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_type text,
  resolution_note text
);

create table public.manga_series_item_unlink_logs (
  id uuid primary key default gen_random_uuid(),
  isbn text not null,
  series_id uuid references public.manga_series(id) on delete set null,
  previous_match_method text not null,
  unlinked_by uuid references auth.users(id) on delete set null,
  unlinked_at timestamptz not null default now()
);

create index manga_series_normalized_madb_title_idx
  on public.manga_series(normalized_madb_title);
create index manga_series_display_title_idx
  on public.manga_series(display_title);
create index rakuten_manga_items_title_idx
  on public.rakuten_manga_items(title);
create index rakuten_manga_items_normalized_title_idx
  on public.rakuten_manga_items(normalized_title);
create index rakuten_manga_item_details_author_idx
  on public.rakuten_manga_item_details(author);
create index rakuten_import_genres_pending_discovery_idx
  on public.rakuten_import_genres(children_discovered_at, genre_id);
create index rakuten_import_genres_pending_import_idx
  on public.rakuten_import_genres(completed_at, genre_id);
create index rakuten_import_genres_daily_pending_idx
  on public.rakuten_import_genres(
    is_leaf,
    daily_cycle_date,
    genre_id
  );
create index manga_series_items_series_id_idx
  on public.manga_series_items(series_id);
create index manga_match_issues_review_queue_idx
  on public.manga_series_item_match_issues(
    is_resolved,
    updated_at desc
  );
create index manga_series_item_unlink_logs_isbn_idx
  on public.manga_series_item_unlink_logs(isbn, unlinked_at desc);

insert into public.rakuten_import_genres (
  genre_id,
  genre_name,
  genre_level
)
values ('001001', '漫画（コミック）', 2);

alter table public.manga_series enable row level security;
alter table public.rakuten_manga_items enable row level security;
alter table public.rakuten_manga_item_details enable row level security;
alter table public.rakuten_import_genres enable row level security;
alter table public.rakuten_import_locks enable row level security;
alter table public.manga_series_items enable row level security;
alter table public.manga_series_item_match_issues enable row level security;
alter table public.manga_series_item_unlink_logs enable row level security;

revoke all on table public.manga_series from anon, authenticated;
revoke all on table public.rakuten_manga_items from anon, authenticated;
revoke all on table public.rakuten_manga_item_details from anon, authenticated;
revoke all on table public.rakuten_import_genres from anon, authenticated;
revoke all on table public.rakuten_import_locks from anon, authenticated;
revoke all on table public.manga_series_items from anon, authenticated;
revoke all on table public.manga_series_item_match_issues
  from anon, authenticated;
revoke all on table public.manga_series_item_unlink_logs
  from anon, authenticated;

grant all on table public.manga_series to service_role;
grant all on table public.rakuten_manga_items to service_role;
grant all on table public.rakuten_manga_item_details to service_role;
grant all on table public.rakuten_import_genres to service_role;
grant all on table public.rakuten_import_locks to service_role;
grant all on table public.manga_series_items to service_role;
grant all on table public.manga_series_item_match_issues to service_role;
grant all on table public.manga_series_item_unlink_logs to service_role;

create or replace function public.acquire_rakuten_import_lock(
  p_lock_name text,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acquired boolean;
begin
  insert into public.rakuten_import_locks (
    lock_name,
    locked_until,
    updated_at
  )
  values (
    p_lock_name,
    now() + make_interval(secs => greatest(1, p_ttl_seconds)),
    now()
  )
  on conflict (lock_name) do update
  set
    locked_until = excluded.locked_until,
    updated_at = excluded.updated_at
  where public.rakuten_import_locks.locked_until <= now()
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.release_rakuten_import_lock(
  p_lock_name text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.rakuten_import_locks
  where lock_name = p_lock_name;
$$;

create or replace function public.link_rakuten_manga_items_batch(
  p_after_isbn text default null,
  p_batch_size integer default 500
)
returns table (
  next_isbn text,
  processed_count integer,
  matched_count integer,
  unmatched_count integer,
  ambiguous_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_processed_count integer := 0;
  v_matched_count integer := 0;
  v_unmatched_count integer := 0;
  v_ambiguous_count integer := 0;
  v_next_isbn text;
begin
  drop table if exists pg_temp.manga_link_batch;
  drop table if exists pg_temp.manga_link_candidates;

  create temporary table manga_link_batch on commit drop as
  select item.isbn, item.normalized_title
  from public.rakuten_manga_items as item
  where (p_after_isbn is null or item.isbn > p_after_isbn)
    and not exists (
      select 1
      from public.manga_series_items as linked
      where linked.isbn = item.isbn
    )
    and not exists (
      select 1
      from public.manga_series_item_match_issues as issue
      where issue.isbn = item.isbn
        and issue.is_resolved = true
    )
  order by item.isbn
  limit greatest(1, least(p_batch_size, 1000));

  select count(*), max(isbn)
  into v_processed_count, v_next_isbn
  from manga_link_batch;

  if v_processed_count = 0 then
    return query select null::text, 0, 0, 0, 0;
    return;
  end if;

  create temporary table manga_link_candidates on commit drop as
  select
    batch.isbn,
    batch.normalized_title,
    count(series.id)::integer as candidate_count,
    coalesce(
      array_agg(series.id order by series.id)
        filter (where series.id is not null),
      '{}'
    ) as candidate_series_ids
  from manga_link_batch as batch
  left join public.manga_series as series
    on series.normalized_madb_title = batch.normalized_title
  group by batch.isbn, batch.normalized_title;

  insert into public.manga_series_items (
    isbn,
    series_id,
    match_method
  )
  select
    isbn,
    candidate_series_ids[1],
    'normalized_title_exact'
  from manga_link_candidates
  where candidate_count = 1
  on conflict (isbn) do update
  set
    series_id = excluded.series_id,
    match_method = excluded.match_method,
    matched_by = null,
    matched_at = now(),
    updated_at = now()
  where public.manga_series_items.match_method <> 'manual';

  get diagnostics v_matched_count = row_count;

  insert into public.manga_series_item_match_issues (
    isbn,
    normalized_title,
    issue_type,
    candidate_count,
    candidate_series_ids,
    is_resolved
  )
  select
    candidate.isbn,
    candidate.normalized_title,
    case
      when candidate.candidate_count = 0 then 'unmatched'
      else 'ambiguous'
    end,
    candidate.candidate_count,
    candidate.candidate_series_ids,
    candidate.isbn not like '978%'
      and candidate.isbn not like '979%'
  from manga_link_candidates as candidate
  left join public.manga_series_items as linked
    on linked.isbn = candidate.isbn
  where linked.isbn is null
    and candidate.candidate_count <> 1
  on conflict (isbn) do update
  set
    normalized_title = excluded.normalized_title,
    issue_type = excluded.issue_type,
    candidate_count = excluded.candidate_count,
    candidate_series_ids = excluded.candidate_series_ids,
    is_resolved = public.manga_series_item_match_issues.is_resolved
      or excluded.is_resolved,
    updated_at = now();

  delete from public.manga_series_item_match_issues as issue
  using public.manga_series_items as linked, manga_link_batch as batch
  where issue.isbn = linked.isbn
    and issue.isbn = batch.isbn;

  select
    count(*) filter (where candidate_count = 0),
    count(*) filter (where candidate_count > 1)
  into v_unmatched_count, v_ambiguous_count
  from manga_link_candidates;

  return query
  select
    v_next_isbn,
    v_processed_count,
    v_matched_count,
    v_unmatched_count,
    v_ambiguous_count;
end;
$$;

create or replace function public.manual_link_manga_items(
  p_isbns text[],
  p_series_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linked_count integer;
begin
  insert into public.manga_series_items (
    isbn,
    series_id,
    match_method,
    matched_by,
    matched_at,
    updated_at
  )
  select
    isbn,
    p_series_id,
    'manual',
    p_user_id,
    now(),
    now()
  from unnest(p_isbns) as isbn
  on conflict (isbn) do update
  set
    series_id = excluded.series_id,
    match_method = excluded.match_method,
    matched_by = excluded.matched_by,
    matched_at = excluded.matched_at,
    updated_at = excluded.updated_at;

  get diagnostics v_linked_count = row_count;

  update public.manga_series_item_match_issues
  set
    is_resolved = true,
    resolved_by = p_user_id,
    resolved_at = now(),
    resolution_type = 'linked',
    updated_at = now()
  where isbn = any(p_isbns);

  return v_linked_count;
end;
$$;

create or replace function public.manual_unlink_manga_item(
  p_isbn text,
  p_series_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.manga_series_items%rowtype;
  v_normalized_title text;
  v_candidate_count integer;
  v_candidate_series_ids uuid[];
begin
  select *
  into v_link
  from public.manga_series_items
  where isbn = p_isbn
    and series_id = p_series_id
  for update;

  if not found then
    return false;
  end if;

  select normalized_title
  into v_normalized_title
  from public.rakuten_manga_items
  where isbn = p_isbn;

  if v_normalized_title is null then
    raise exception 'Rakuten manga item was not found for ISBN %', p_isbn;
  end if;

  select
    count(series.id)::integer,
    coalesce(
      array_agg(series.id order by series.id)
        filter (where series.id is not null),
      '{}'
    )
  into v_candidate_count, v_candidate_series_ids
  from public.manga_series as series
  where series.normalized_madb_title = v_normalized_title;

  insert into public.manga_series_item_unlink_logs (
    isbn,
    series_id,
    previous_match_method,
    unlinked_by
  )
  values (
    v_link.isbn,
    v_link.series_id,
    v_link.match_method,
    p_user_id
  );

  delete from public.manga_series_items
  where isbn = p_isbn
    and series_id = p_series_id;

  insert into public.manga_series_item_match_issues (
    isbn,
    normalized_title,
    issue_type,
    candidate_count,
    candidate_series_ids,
    is_resolved,
    detected_at,
    updated_at,
    resolved_by,
    resolved_at,
    resolution_type,
    resolution_note
  )
  values (
    p_isbn,
    v_normalized_title,
    case when v_candidate_count > 1 then 'ambiguous' else 'unmatched' end,
    v_candidate_count,
    v_candidate_series_ids,
    false,
    now(),
    now(),
    null,
    null,
    null,
    null
  )
  on conflict (isbn) do update
  set
    normalized_title = excluded.normalized_title,
    issue_type = excluded.issue_type,
    candidate_count = excluded.candidate_count,
    candidate_series_ids = excluded.candidate_series_ids,
    is_resolved = false,
    updated_at = now(),
    resolved_by = null,
    resolved_at = null,
    resolution_type = null,
    resolution_note = null;

  return true;
end;
$$;

revoke all on function public.acquire_rakuten_import_lock(text, integer)
  from public, anon, authenticated;
revoke all on function public.release_rakuten_import_lock(text)
  from public, anon, authenticated;
revoke all on function public.link_rakuten_manga_items_batch(text, integer)
  from public, anon, authenticated;
revoke all on function public.manual_link_manga_items(text[], uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.manual_unlink_manga_item(text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.acquire_rakuten_import_lock(text, integer)
  to service_role;
grant execute on function public.release_rakuten_import_lock(text)
  to service_role;
grant execute on function public.link_rakuten_manga_items_batch(text, integer)
  to service_role;
grant execute on function public.manual_link_manga_items(text[], uuid, uuid)
  to service_role;
grant execute on function public.manual_unlink_manga_item(text, uuid, uuid)
  to service_role;
