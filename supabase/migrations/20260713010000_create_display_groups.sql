create table if not exists public.display_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint display_groups_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.display_group_series (
  display_group_id uuid not null references public.display_groups(id) on delete cascade,
  series_id uuid not null references public.series(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (display_group_id, series_id)
);

create index if not exists display_groups_active_order_idx
  on public.display_groups(is_active, sort_order, name, id);

create index if not exists display_group_series_group_order_idx
  on public.display_group_series(display_group_id, sort_order, series_id);

create index if not exists display_group_series_series_idx
  on public.display_group_series(series_id);

alter table public.display_groups enable row level security;
alter table public.display_group_series enable row level security;

drop policy if exists display_groups_public_select on public.display_groups;
create policy display_groups_public_select
  on public.display_groups
  for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists display_group_series_public_select on public.display_group_series;
create policy display_group_series_public_select
  on public.display_group_series
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.display_groups as display_group
      where display_group.id = display_group_series.display_group_id
        and display_group.is_active = true
    )
  );

grant select on table public.display_groups to anon, authenticated;
grant select on table public.display_group_series to anon, authenticated;
grant all on table public.display_groups to service_role;
grant all on table public.display_group_series to service_role;
