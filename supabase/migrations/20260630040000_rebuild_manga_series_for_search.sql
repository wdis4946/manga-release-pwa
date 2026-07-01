-- madb_manga_series must be populated before this destructive reset.
truncate table public.manga_series cascade;

alter table public.manga_series
  drop column if exists normalized_madb_title,
  drop column if exists description;

alter table public.manga_series
  rename column madb_title to search_title;

alter table public.manga_series
  rename constraint manga_series_madb_title_key
  to manga_series_search_title_key;

drop index if exists public.manga_series_normalized_madb_title_idx;

create index if not exists manga_series_normalized_search_title_idx
  on public.manga_series (
    public.normalize_manga_title(search_title, false)
  );

update public.manga_series_item_match_issues
set
  issue_type = 'unmatched',
  candidate_count = 0,
  candidate_series_ids = '{}',
  is_resolved = false,
  resolved_by = null,
  resolved_at = null,
  resolution_type = null,
  resolution_note = null,
  updated_at = now();

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
    on public.normalize_manga_title(series.search_title, false)
      = batch.normalized_title
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
    execute
      'select normalized_title
       from public.madb_manga_items
       where isbn = $1'
    into v_normalized_title
    using p_isbn;
  end if;

  if v_normalized_title is null then
    raise exception 'Manga item was not found for ISBN %', p_isbn;
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
  where public.normalize_manga_title(series.search_title, false)
    = v_normalized_title;

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
