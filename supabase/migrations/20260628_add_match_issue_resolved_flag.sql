alter table public.manga_series_item_match_issues
  add column if not exists is_resolved boolean not null default false;

-- Reset every existing issue to the unresolved state for the first review.
update public.manga_series_item_match_issues
set
  is_resolved = false,
  updated_at = now();
