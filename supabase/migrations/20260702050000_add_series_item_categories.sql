create table if not exists public.manga_series_categories (
  series_id uuid not null
    references public.manga_series(id) on delete cascade,
  category_number integer not null default 0,
  category_name text not null default 'default',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (series_id, category_number),
  constraint manga_series_categories_number_nonnegative
    check (category_number >= 0)
);

alter table public.manga_series_items
  add column if not exists category_number integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'manga_series_items_category_number_nonnegative'
      and conrelid = 'public.manga_series_items'::regclass
  ) then
    alter table public.manga_series_items
      add constraint manga_series_items_category_number_nonnegative
      check (category_number >= 0) not valid;
  end if;
end;
$$;

alter table public.manga_series_items
  validate constraint manga_series_items_category_number_nonnegative;

insert into public.manga_series_categories (
  series_id,
  category_number,
  category_name
)
select
  series.id,
  0,
  'default'
from public.manga_series as series
on conflict (series_id, category_number) do nothing;

insert into public.manga_series_categories (
  series_id,
  category_number,
  category_name
)
select distinct
  series.id,
  coalesce(series.category_number, 0),
  coalesce(nullif(btrim(series.category_name), ''), 'default')
from public.manga_series as series
where coalesce(series.category_number, 0) <> 0
on conflict (series_id, category_number) do update
set
  category_name = excluded.category_name,
  updated_at = now();

create or replace function public.ensure_default_manga_series_category()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.manga_series_categories (
    series_id,
    category_number,
    category_name
  )
  values (
    new.id,
    0,
    'default'
  )
  on conflict (series_id, category_number) do nothing;

  return new;
end;
$$;

drop trigger if exists manga_series_default_category_trigger
  on public.manga_series;
create trigger manga_series_default_category_trigger
  after insert on public.manga_series
  for each row
  execute function public.ensure_default_manga_series_category();

create index if not exists manga_series_items_series_category_idx
  on public.manga_series_items(series_id, category_number, isbn);

alter table public.manga_series_categories enable row level security;

revoke all on table public.manga_series_categories
  from anon, authenticated;
grant all on table public.manga_series_categories
  to service_role;

create or replace function public.update_manga_series_category(
  p_series_id uuid,
  p_category_number integer,
  p_new_category_number integer,
  p_category_name text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.manga_series_categories%rowtype;
begin
  if p_category_number < 0 or p_new_category_number < 0 then
    raise exception 'Category number must be non-negative.';
  end if;

  if nullif(btrim(p_category_name), '') is null then
    raise exception 'Category name is required.';
  end if;

  select *
  into v_existing
  from public.manga_series_categories
  where series_id = p_series_id
    and category_number = p_category_number
  for update;

  if not found then
    return false;
  end if;

  if p_category_number <> p_new_category_number
    and exists (
      select 1
      from public.manga_series_categories
      where series_id = p_series_id
        and category_number = p_new_category_number
    )
  then
    raise exception 'Category number already exists.';
  end if;

  update public.manga_series_categories
  set
    category_number = p_new_category_number,
    category_name = btrim(p_category_name),
    updated_at = now()
  where series_id = p_series_id
    and category_number = p_category_number;

  update public.manga_series_items
  set
    category_number = p_new_category_number,
    updated_at = now()
  where series_id = p_series_id
    and category_number = p_category_number;

  return true;
end;
$$;

create or replace function public.move_manga_series_items_to_category(
  p_series_id uuid,
  p_isbns text[],
  p_category_number integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_moved_count integer;
begin
  if p_category_number < 0 then
    raise exception 'Category number must be non-negative.';
  end if;

  if not exists (
    select 1
    from public.manga_series_categories
    where series_id = p_series_id
      and category_number = p_category_number
  ) then
    raise exception 'Category was not found.';
  end if;

  update public.manga_series_items
  set
    category_number = p_category_number,
    updated_at = now()
  where series_id = p_series_id
    and isbn = any(p_isbns);

  get diagnostics v_moved_count = row_count;

  return v_moved_count;
end;
$$;

revoke all on function public.update_manga_series_category(uuid, integer, integer, text)
  from public, anon, authenticated;
revoke all on function public.move_manga_series_items_to_category(uuid, text[], integer)
  from public, anon, authenticated;
revoke all on function public.ensure_default_manga_series_category()
  from public, anon, authenticated;

grant execute on function public.update_manga_series_category(uuid, integer, integer, text)
  to service_role;
grant execute on function public.move_manga_series_items_to_category(uuid, text[], integer)
  to service_role;
