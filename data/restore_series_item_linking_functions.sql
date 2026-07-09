-- シリーズ管理画面のアイテム登録で使う series_items 関連関数を復旧するSQL。
-- Supabase SQL Editorで直接実行してください。

create or replace function public.assign_series_item_display_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.display_order is null
    or exists (
      select 1
      from public.series_items as existing
      where existing.series_id = new.series_id
        and existing.category_number = new.category_number
        and existing.display_order = new.display_order
        and existing.isbn <> new.isbn
    )
  then
    select coalesce(max(existing.display_order), -1) + 1
    into new.display_order
    from public.series_items as existing
    where existing.series_id = new.series_id
      and existing.category_number = new.category_number;
  end if;

  return new;
end;
$$;

drop trigger if exists series_item_display_order_trigger
  on public.series_items;
create trigger series_item_display_order_trigger
  before insert on public.series_items
  for each row
  execute function public.assign_series_item_display_order();

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
  insert into public.series_items (
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

  update public.series_item_match_issues
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

revoke all on function public.assign_series_item_display_order()
  from public, anon, authenticated;
grant execute on function public.assign_series_item_display_order()
  to service_role;

revoke all on function public.manual_link_manga_items(text[], uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.manual_link_manga_items(text[], uuid, uuid)
  to service_role;

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
  v_link public.series_items%rowtype;
  v_normalized_title text;
  v_candidate_count integer;
  v_candidate_series_ids uuid[];
begin
  select *
  into v_link
  from public.series_items
  where isbn = p_isbn
    and series_id = p_series_id
  for update;

  if not found then
    return false;
  end if;

  select coalesce(
    rakuten.normalized_title,
    openbd.normalized_title,
    madb.normalized_title,
    issue.normalized_title,
    p_isbn
  )
  into v_normalized_title
  from (select p_isbn as isbn) as target
  left join public.rakuten_manga_items as rakuten
    on rakuten.isbn = target.isbn
  left join public.openbd_manga_items as openbd
    on openbd.isbn = target.isbn
  left join public.madb_manga_items as madb
    on madb.isbn = target.isbn
  left join public.series_item_match_issues as issue
    on issue.isbn = target.isbn;

  select
    count(series.id)::integer,
    coalesce(
      array_agg(series.id order by series.id)
        filter (where series.id is not null),
      '{}'
    )
  into v_candidate_count, v_candidate_series_ids
  from public.series as series
  where public.normalize_manga_title(series.search_title, false)
    = v_normalized_title;

  insert into public.series_item_unlink_logs (
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

  delete from public.series_items
  where isbn = p_isbn
    and series_id = p_series_id;

  insert into public.series_item_match_issues (
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
    'Returned to review queue by manual unlink.'
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
    resolution_note = excluded.resolution_note;

  return true;
end;
$$;

revoke all on function public.manual_unlink_manga_item(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.manual_unlink_manga_item(text, uuid, uuid)
  to service_role;

select
  proname,
  pg_get_function_arguments(oid) as arguments,
  pg_get_function_result(oid) as result_type
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'assign_series_item_display_order',
    'manual_link_manga_items',
    'manual_unlink_manga_item'
  )
order by proname;
