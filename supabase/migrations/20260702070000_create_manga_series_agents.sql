create table if not exists public.manga_series_agents (
  series_id uuid not null
    references public.manga_series(id) on delete cascade,
  agent_id uuid not null
    references public.agents(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  constraint manga_series_agents_pkey primary key (series_id, agent_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.manga_series_agents'::regclass
      and conname = 'manga_series_agents_series_id_fkey'
  ) then
    alter table public.manga_series_agents
      add constraint manga_series_agents_series_id_fkey
      foreign key (series_id)
      references public.manga_series(id)
      on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.manga_series_agents'::regclass
      and conname = 'manga_series_agents_agent_id_fkey'
  ) then
    alter table public.manga_series_agents
      add constraint manga_series_agents_agent_id_fkey
      foreign key (agent_id)
      references public.agents(id)
      on delete cascade;
  end if;
end $$;

create index if not exists manga_series_agents_agent_id_idx
  on public.manga_series_agents using btree (agent_id);

create index if not exists manga_series_agents_series_sort_order_idx
  on public.manga_series_agents using btree (series_id, sort_order);

with matched_agents as (
  select distinct on (series.id, agent.id)
    series.id as series_id,
    agent.id as agent_id,
    author_url.ordinality
  from public.wiki_manga_series as wiki
  join public.manga_series as series
    on public.normalize_manga_title(series.search_title, false) = wiki.normalized_title
  cross join lateral regexp_split_to_table(
    coalesce(wiki.authors_wiki_url, ''),
    '\s*,\s*'
  ) with ordinality as author_url(wiki_url, ordinality)
  join public.agents as agent
    on btrim(agent.author_wiki_link) = btrim(author_url.wiki_url)
  where btrim(author_url.wiki_url) <> ''
  order by
    series.id,
    agent.id,
    author_url.ordinality
)
insert into public.manga_series_agents (
  series_id,
  agent_id,
  sort_order
)
select
  series_id,
  agent_id,
  row_number() over (
    partition by series_id
    order by ordinality, agent_id
  )::integer - 1 as sort_order
from matched_agents
on conflict (series_id, agent_id)
do update set
  sort_order = excluded.sort_order;

alter table public.manga_series_agents enable row level security;

revoke all on table public.manga_series_agents
  from anon, authenticated;
grant all on table public.manga_series_agents
  to service_role;
