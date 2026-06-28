create table if not exists public.manga_series_item_match_issues (
  isbn text primary key
    references public.rakuten_manga_items(isbn) on delete cascade,
  normalized_title text not null,
  issue_type text not null
    check (issue_type in ('unmatched', 'ambiguous')),
  candidate_count integer not null default 0,
  candidate_series_ids uuid[] not null default '{}',
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.manga_series_item_match_issues enable row level security;
revoke all on table public.manga_series_item_match_issues
  from anon, authenticated;
grant all on table public.manga_series_item_match_issues to service_role;

create or replace function public.link_rakuten_manga_items()
returns table (
  matched_count bigint,
  unmatched_count bigint,
  ambiguous_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only one-candidate matches are linked. Manual links are never overwritten.
  with candidates as (
    select
      item.isbn,
      count(series.id)::integer as candidate_count,
      array_agg(series.id order by series.id) as candidate_series_ids
    from public.rakuten_manga_items as item
    join public.manga_series as series
      on series.normalized_title = item.normalized_title
    group by item.isbn
  ),
  unique_candidates as (
    select
      isbn,
      candidate_series_ids[1] as series_id
    from candidates
    where candidate_count = 1
  )
  insert into public.manga_series_items (
    isbn,
    series_id,
    match_method
  )
  select
    isbn,
    series_id,
    'normalized_title_exact'
  from unique_candidates
  on conflict (isbn) do update
  set
    series_id = excluded.series_id,
    match_method = excluded.match_method,
    updated_at = now()
  where public.manga_series_items.match_method <> 'manual';

  -- Record titles that unexpectedly match more than one series.
  with candidates as (
    select
      item.isbn,
      item.normalized_title,
      count(series.id)::integer as candidate_count,
      array_agg(series.id order by series.id) as candidate_series_ids
    from public.rakuten_manga_items as item
    join public.manga_series as series
      on series.normalized_title = item.normalized_title
    left join public.manga_series_items as linked
      on linked.isbn = item.isbn
    where linked.isbn is null
    group by item.isbn, item.normalized_title
    having count(series.id) > 1
  )
  insert into public.manga_series_item_match_issues (
    isbn,
    normalized_title,
    issue_type,
    candidate_count,
    candidate_series_ids
  )
  select
    isbn,
    normalized_title,
    'ambiguous',
    candidate_count,
    candidate_series_ids
  from candidates
  on conflict (isbn) do update
  set
    normalized_title = excluded.normalized_title,
    issue_type = excluded.issue_type,
    candidate_count = excluded.candidate_count,
    candidate_series_ids = excluded.candidate_series_ids,
    updated_at = now();

  -- Keep every currently unmatched item visible for later manual work.
  insert into public.manga_series_item_match_issues (
    isbn,
    normalized_title,
    issue_type,
    candidate_count,
    candidate_series_ids
  )
  select
    item.isbn,
    item.normalized_title,
    'unmatched',
    0,
    '{}'
  from public.rakuten_manga_items as item
  left join public.manga_series_items as linked
    on linked.isbn = item.isbn
  left join public.manga_series as series
    on series.normalized_title = item.normalized_title
  where linked.isbn is null
    and series.id is null
  on conflict (isbn) do update
  set
    normalized_title = excluded.normalized_title,
    issue_type = excluded.issue_type,
    candidate_count = excluded.candidate_count,
    candidate_series_ids = excluded.candidate_series_ids,
    updated_at = now();

  delete from public.manga_series_item_match_issues as issue
  using public.manga_series_items as linked
  where issue.isbn = linked.isbn;

  return query
  select
    (select count(*) from public.manga_series_items),
    (
      select count(*)
      from public.manga_series_item_match_issues
      where issue_type = 'unmatched'
    ),
    (
      select count(*)
      from public.manga_series_item_match_issues
      where issue_type = 'ambiguous'
    );
end;
$$;

revoke all on function public.link_rakuten_manga_items()
  from public, anon, authenticated;
grant execute on function public.link_rakuten_manga_items()
  to service_role;
