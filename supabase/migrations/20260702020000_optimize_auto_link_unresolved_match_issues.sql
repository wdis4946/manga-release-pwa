create schema if not exists extensions;

create extension if not exists pg_trgm
  with schema extensions;

create index if not exists manga_series_normalized_search_title_btree_idx
  on public.manga_series (
    public.normalize_manga_title(search_title, false)
  );

create or replace function public.auto_link_unresolved_match_issues_batch(
  p_after_isbn text default null,
  p_batch_size integer default 100,
  p_similarity_threshold real default 0.83,
  p_min_similarity_length integer default 4
)
returns table (
  next_isbn text,
  processed_count integer,
  linked_count integer,
  missing_item_count integer,
  unmatched_count integer,
  ambiguous_count integer
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_processed_count integer := 0;
  v_linked_count integer := 0;
  v_missing_item_count integer := 0;
  v_unmatched_count integer := 0;
  v_ambiguous_count integer := 0;
  v_next_isbn text;
begin
  drop table if exists pg_temp.auto_link_batch;
  drop table if exists pg_temp.auto_link_items;
  drop table if exists pg_temp.auto_link_exact_candidates;
  drop table if exists pg_temp.auto_link_similarity_candidates;
  drop table if exists pg_temp.auto_link_candidates;
  drop table if exists pg_temp.auto_link_summary;

  create temporary table auto_link_batch on commit drop as
  select issue.isbn
  from public.manga_series_item_match_issues as issue
  where issue.is_resolved = false
    and (p_after_isbn is null or issue.isbn > p_after_isbn)
    and not exists (
      select 1
      from public.manga_series_items as linked
      where linked.isbn = issue.isbn
    )
  order by issue.isbn
  limit greatest(1, least(p_batch_size, 250));

  select count(*), max(isbn)
  into v_processed_count, v_next_isbn
  from auto_link_batch;

  if v_processed_count = 0 then
    return query select null::text, 0, 0, 0, 0, 0;
    return;
  end if;

  create temporary table auto_link_items on commit drop as
  select
    batch.isbn,
    coalesce(
      rakuten.normalized_title,
      openbd.normalized_title,
      madb.normalized_title
    ) as item_normalized_title,
    case
      when rakuten.normalized_title is not null then 'rakuten'
      when openbd.normalized_title is not null then 'openbd'
      when madb.normalized_title is not null then 'madb'
      else null
    end as item_source
  from auto_link_batch as batch
  left join public.rakuten_manga_items as rakuten
    on rakuten.isbn = batch.isbn
  left join public.openbd_manga_items as openbd
    on openbd.isbn = batch.isbn
  left join public.madb_manga_items as madb
    on madb.isbn = batch.isbn;

  create temporary table auto_link_exact_candidates on commit drop as
  select
    item.isbn,
    item.item_normalized_title,
    item.item_source,
    series.id as series_id,
    1::real as similarity_score,
    'auto_title_exact'::text as match_method
  from auto_link_items as item
  join public.manga_series as series
    on public.normalize_manga_title(series.search_title, false)
      = item.item_normalized_title
  where item.item_normalized_title is not null;

  create temporary table auto_link_similarity_candidates on commit drop as
  select
    item.isbn,
    item.item_normalized_title,
    item.item_source,
    similar.series_id,
    similar.similarity_score,
    'auto_title_similarity'::text as match_method
  from auto_link_items as item
  cross join lateral (
    select
      series.id as series_id,
      similarity(
        public.normalize_manga_title(series.search_title, false),
        item.item_normalized_title
      ) as similarity_score
    from public.manga_series as series
    where item.item_normalized_title is not null
      and char_length(item.item_normalized_title) >= p_min_similarity_length
      and public.normalize_manga_title(series.search_title, false)
        <> item.item_normalized_title
    order by
      public.normalize_manga_title(series.search_title, false)
        OPERATOR(extensions.<->)
      item.item_normalized_title,
      series.id
    limit 2
  ) as similar
  where similar.similarity_score >= p_similarity_threshold;

  create temporary table auto_link_candidates on commit drop as
  select * from auto_link_exact_candidates
  union all
  select * from auto_link_similarity_candidates;

  create temporary table auto_link_summary on commit drop as
  select
    item.isbn,
    item.item_normalized_title,
    item.item_source,
    count(candidate.series_id)::integer as candidate_count,
    coalesce(
      array_agg(candidate.series_id order by candidate.match_method, candidate.similarity_score desc, candidate.series_id)
        filter (where candidate.series_id is not null),
      '{}'
    ) as candidate_series_ids,
    (array_agg(candidate.series_id order by candidate.match_method, candidate.similarity_score desc, candidate.series_id)
      filter (where candidate.series_id is not null))[1] as best_series_id,
    (array_agg(candidate.match_method order by candidate.match_method, candidate.similarity_score desc, candidate.series_id)
      filter (where candidate.series_id is not null))[1] as best_match_method
  from auto_link_items as item
  left join auto_link_candidates as candidate
    on candidate.isbn = item.isbn
  group by item.isbn, item.item_normalized_title, item.item_source;

  insert into public.manga_series_items (
    isbn,
    series_id,
    match_method,
    matched_by,
    matched_at,
    updated_at
  )
  select
    summary.isbn,
    summary.best_series_id,
    case
      when summary.best_match_method = 'auto_title_exact'
        then summary.item_source || '_title_exact'
      else summary.item_source || '_title_similarity_083'
    end,
    null,
    now(),
    now()
  from auto_link_summary as summary
  where summary.item_normalized_title is not null
    and summary.candidate_count = 1
  on conflict (isbn) do update
  set
    series_id = excluded.series_id,
    match_method = excluded.match_method,
    matched_by = null,
    matched_at = excluded.matched_at,
    updated_at = excluded.updated_at
  where public.manga_series_items.match_method <> 'manual';

  get diagnostics v_linked_count = row_count;

  update public.manga_series_item_match_issues as issue
  set
    is_resolved = true,
    resolved_by = null,
    resolved_at = now(),
    resolution_type = 'linked',
    resolution_note = 'Automatically linked by item title exact/similarity batch.',
    updated_at = now()
  from auto_link_summary as summary
  where issue.isbn = summary.isbn
    and summary.item_normalized_title is not null
    and summary.candidate_count = 1;

  update public.manga_series_item_match_issues as issue
  set
    normalized_title = coalesce(summary.item_normalized_title, issue.normalized_title),
    issue_type = case
      when summary.candidate_count > 1 then 'ambiguous'
      else 'unmatched'
    end,
    candidate_count = summary.candidate_count,
    candidate_series_ids = summary.candidate_series_ids,
    resolution_note = case
      when summary.item_normalized_title is null
        then 'No item normalized title was found in Rakuten, openBD, or MADB.'
      when summary.candidate_count = 0
        then 'No manga_series search_title matched item normalized title by exact/similarity rule.'
      else 'Multiple manga_series rows matched item normalized title by exact/similarity rule.'
    end,
    updated_at = now()
  from auto_link_summary as summary
  where issue.isbn = summary.isbn
    and issue.is_resolved = false
    and summary.candidate_count <> 1;

  select
    count(*) filter (where item_normalized_title is null),
    count(*) filter (
      where item_normalized_title is not null
        and candidate_count = 0
    ),
    count(*) filter (
      where item_normalized_title is not null
        and candidate_count > 1
    )
  into v_missing_item_count, v_unmatched_count, v_ambiguous_count
  from auto_link_summary;

  return query
  select
    v_next_isbn,
    v_processed_count,
    v_linked_count,
    v_missing_item_count,
    v_unmatched_count,
    v_ambiguous_count;
end;
$$;

revoke all on function public.auto_link_unresolved_match_issues_batch(text, integer, real, integer)
  from public, anon, authenticated;
grant execute on function public.auto_link_unresolved_match_issues_batch(text, integer, real, integer)
  to service_role;
