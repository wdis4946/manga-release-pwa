create table if not exists public.manga_series_item_unlink_logs (
  id uuid primary key default gen_random_uuid(),
  isbn text not null,
  series_id uuid references public.manga_series(id) on delete set null,
  previous_match_method text not null,
  unlinked_by uuid references auth.users(id),
  unlinked_at timestamptz not null default now()
);

alter table public.manga_series_item_unlink_logs enable row level security;
revoke all on table public.manga_series_item_unlink_logs
  from anon, authenticated;
grant all on table public.manga_series_item_unlink_logs to service_role;

create index if not exists manga_series_item_unlink_logs_isbn_idx
  on public.manga_series_item_unlink_logs (isbn, unlinked_at desc);

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
  -- Lock the link so two administrators cannot unlink the same item at once.
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
  where series.normalized_title = v_normalized_title;

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

revoke all on function public.manual_unlink_manga_item(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.manual_unlink_manga_item(text, uuid, uuid)
  to service_role;
