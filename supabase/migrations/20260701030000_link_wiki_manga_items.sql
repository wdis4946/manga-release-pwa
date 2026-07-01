alter table public.manga_series_item_match_issues
  drop constraint if exists manga_series_item_match_issues_isbn_fkey;

alter table public.manga_series_items
  drop constraint if exists manga_series_items_isbn_fkey;

-- PostgreSQL cannot change a function's OUT-parameter row type with
-- CREATE OR REPLACE, so remove an older version before recreating it.
drop function if exists public.link_wiki_manga_items();

create function public.link_wiki_manga_items()
returns table (
  parsed_count bigint,
  linked_count bigint,
  unmatched_count bigint,
  ambiguous_count bigint,
  missing_rakuten_count bigint,
  missing_source_count bigint,
  missing_series_count bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linked_count bigint := 0;
begin
  drop table if exists pg_temp.wiki_item_candidates;
  drop table if exists pg_temp.wiki_item_summary;

  create temporary table wiki_item_candidates on commit drop as
  with parsed as (
    select distinct
      wiki.id as series_id,
      wiki.normalized_title as wiki_normalized_title,
      regexp_replace(
        btrim(token.value),
        '[-[:space:]]',
        '',
        'g'
      ) as isbn
    from public.wiki_manga_series as wiki
    cross join lateral regexp_split_to_table(
      coalesce(wiki.items, ''),
      '[,、，]'
    ) as token(value)
    where regexp_replace(
      btrim(token.value),
      '[-[:space:]]',
      '',
      'g'
    ) <> ''
  )
  select
    parsed.series_id,
    parsed.wiki_normalized_title,
    parsed.isbn,
    item.normalized_title as rakuten_normalized_title,
    madb_item.normalized_title as madb_normalized_title,
    item.isbn is not null as rakuten_item_exists,
    madb_item.isbn is not null as madb_item_exists,
    series.id is not null as manga_series_exists,
    coalesce(
      item.normalized_title,
      madb_item.normalized_title
    ) = parsed.wiki_normalized_title as title_matches
  from parsed
  left join public.rakuten_manga_items as item
    on item.isbn = parsed.isbn
  left join public.madb_manga_items as madb_item
    on madb_item.isbn = parsed.isbn
  left join public.manga_series as series
    on series.id = parsed.series_id;

  create temporary table wiki_item_summary on commit drop as
  select
    candidate.isbn,
    coalesce(
      max(candidate.rakuten_normalized_title),
      max(candidate.madb_normalized_title),
      min(candidate.wiki_normalized_title)
    ) as normalized_title,
    bool_or(candidate.rakuten_item_exists) as rakuten_item_exists,
    bool_or(candidate.madb_item_exists) as madb_item_exists,
    bool_or(candidate.manga_series_exists) as manga_series_exists,
    count(distinct candidate.series_id)
      filter (
        where candidate.title_matches
          and candidate.manga_series_exists
      )::integer as exact_match_count,
    coalesce(
      array_agg(distinct candidate.series_id order by candidate.series_id)
        filter (
          where candidate.title_matches
            and candidate.manga_series_exists
        ),
      '{}'
    ) as exact_series_ids,
    count(distinct candidate.series_id)::integer as source_series_count,
    array_agg(distinct candidate.series_id order by candidate.series_id)
      as source_series_ids
  from wiki_item_candidates as candidate
  group by candidate.isbn;

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
    summary.exact_series_ids[1],
    case
      when summary.rakuten_item_exists
        then 'wiki_items_rakuten_title_exact'
      else 'wiki_items_madb_title_exact'
    end,
    null,
    now(),
    now()
  from wiki_item_summary as summary
  where (
      summary.rakuten_item_exists
      or summary.madb_item_exists
    )
    and summary.exact_match_count = 1
  on conflict (isbn) do update
  set
    series_id = excluded.series_id,
    match_method = excluded.match_method,
    matched_by = null,
    matched_at = excluded.matched_at,
    updated_at = excluded.updated_at
  where public.manga_series_items.match_method <> 'manual';

  get diagnostics v_linked_count = row_count;

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
  select
    summary.isbn,
    summary.normalized_title,
    case
      when summary.exact_match_count > 1 then 'ambiguous'
      else 'unmatched'
    end,
    summary.source_series_count,
    summary.source_series_ids,
    false,
    now(),
    now(),
    null,
    null,
    null,
    case
      when not summary.rakuten_item_exists
        and not summary.madb_item_exists
        then 'ISBN was not found in Rakuten or MADB manga items.'
      when not summary.manga_series_exists
        then 'Wiki series UUID was not found in manga_series.'
      when summary.exact_match_count = 0
        then 'Wiki and Rakuten normalized titles did not match.'
      else 'Multiple series matched the same ISBN.'
    end
  from wiki_item_summary as summary
  left join public.manga_series_items as linked
    on linked.isbn = summary.isbn
  where linked.isbn is null
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
    resolution_note = excluded.resolution_note;

  delete from public.manga_series_item_match_issues as issue
  using public.manga_series_items as linked, wiki_item_summary as summary
  where issue.isbn = linked.isbn
    and issue.isbn = summary.isbn;

  return query
  select
    (select count(*) from wiki_item_candidates),
    v_linked_count,
    (
      select count(*)
      from wiki_item_summary
      where exact_match_count = 0
    ),
    (
      select count(*)
      from wiki_item_summary
      where exact_match_count > 1
    ),
    (
      select count(*)
      from wiki_item_summary
      where not rakuten_item_exists
    ),
    (
      select count(*)
      from wiki_item_summary
      where not rakuten_item_exists
        and not madb_item_exists
    ),
    (
      select count(*)
      from wiki_item_summary
      where not manga_series_exists
    );
end;
$$;

revoke all on function public.link_wiki_manga_items()
  from public, anon, authenticated;
grant execute on function public.link_wiki_manga_items()
  to service_role;
