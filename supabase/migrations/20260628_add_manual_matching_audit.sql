alter table public.manga_series_items
  add column if not exists matched_by uuid references auth.users(id),
  add column if not exists matched_at timestamptz not null default now();

alter table public.manga_series_item_match_issues
  add column if not exists resolved_by uuid references auth.users(id),
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_type text,
  add column if not exists resolution_note text;

create index if not exists manga_match_issues_review_queue_idx
  on public.manga_series_item_match_issues (
    is_resolved,
    updated_at desc
  );

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

revoke all on function public.manual_link_manga_items(text[], uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.manual_link_manga_items(text[], uuid, uuid)
  to service_role;
