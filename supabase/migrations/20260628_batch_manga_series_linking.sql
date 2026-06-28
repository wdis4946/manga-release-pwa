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
    coalesce(array_agg(series.id order by series.id)
      filter (where series.id is not null), '{}') as candidate_series_ids
  from manga_link_batch as batch
  left join public.manga_series as series
    on series.normalized_title = batch.normalized_title
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
    updated_at = now()
  where public.manga_series_items.match_method <> 'manual';

  get diagnostics v_matched_count = row_count;

  insert into public.manga_series_item_match_issues (
    isbn,
    normalized_title,
    issue_type,
    candidate_count,
    candidate_series_ids
  )
  select
    candidate.isbn,
    candidate.normalized_title,
    case
      when candidate.candidate_count = 0 then 'unmatched'
      else 'ambiguous'
    end,
    candidate.candidate_count,
    candidate.candidate_series_ids
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

revoke all on function public.link_rakuten_manga_items_batch(text, integer)
  from public, anon, authenticated;
grant execute on function public.link_rakuten_manga_items_batch(text, integer)
  to service_role;
