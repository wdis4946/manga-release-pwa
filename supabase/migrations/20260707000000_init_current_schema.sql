-- Consolidated schema generated from the current Supabase public schema.
-- Data is intentionally not included.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

CREATE OR REPLACE FUNCTION public.normalize_manga_title(input_title text, remove_volume_suffix boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
AS $function$
declare
  normalized text;
  without_new_edition text;
  stripped text;
begin
  normalized := lower(
    btrim(
      regexp_replace(
        replace(normalize(input_title, NFKC), '　', ' '),
        '[[:space:]]+',
        ' ',
        'g'
      )
    )
  );

  if not remove_volume_suffix then
    return normalized;
  end if;

  without_new_edition := btrim(
    regexp_replace(normalized, '[[:space:]]*新版$', '', 'g')
  );
  without_new_edition := coalesce(
    nullif(without_new_edition, ''),
    normalized
  );

  stripped := btrim(
    regexp_replace(
      without_new_edition,
      '[[:space:]]*(第[[:space:]]*[0-9]+[[:space:]]*巻|[(][[:space:]]*[0-9]+[[:space:]]*[)]|vol[.]?[[:space:]]*[0-9]+|[0-9]+[[:space:]]*巻|[0-9]+)$',
      '',
      'i'
    )
  );

  return coalesce(nullif(stripped, ''), without_new_edition);
end;
$function$;

create table if not exists public.agents (
  id uuid default gen_random_uuid() not null,
  name text not null,
  birth_date date,
  active_start_year integer,
  active_end_year integer,
  birth_place text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  author_wiki_link text,
  gender text
);

create table if not exists public.madb_manga_items (
  isbn text not null,
  title text not null,
  normalized_title text generated always as (normalize_manga_title(title, true)) stored,
  authors text,
  publisher text,
  imprint text
);

create table if not exists public.madb_manga_series (
  id uuid default gen_random_uuid() not null,
  title text not null,
  normalized_title text generated always as (normalize_manga_title(title, false)) stored,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.genres (
  id uuid default gen_random_uuid() not null,
  name text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.series (
  id uuid default gen_random_uuid() not null,
  search_title text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  display_title text not null,
  description text,
  representative_image_path text
);

create table if not exists public.series_agents (
  series_id uuid not null,
  agent_id uuid not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.series_categories (
  series_id uuid not null,
  category_number integer default 0 not null,
  category_name text default 'default'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.series_genres (
  series_id uuid not null,
  genre_id uuid not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.series_item_match_issues (
  isbn text not null,
  normalized_title text not null,
  issue_type text not null,
  candidate_count integer default 0 not null,
  candidate_series_ids uuid[] default '{}'::uuid[] not null,
  is_resolved boolean default false not null,
  detected_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  resolution_type text,
  resolution_note text,
  source_title text,
  title_source text,
  title_lookup_status text,
  title_lookup_at timestamp with time zone
);

create table if not exists public.series_item_unlink_logs (
  id uuid default gen_random_uuid() not null,
  isbn text not null,
  series_id uuid,
  previous_match_method text not null,
  unlinked_by uuid,
  unlinked_at timestamp with time zone default now() not null
);

create table if not exists public.series_items (
  isbn text not null,
  series_id uuid not null,
  match_method text not null,
  matched_by uuid,
  matched_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  category_number integer default 0 not null,
  display_order integer not null
);

create table if not exists public.series_publishers (
  series_id uuid not null,
  publisher_id uuid not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.openbd_manga_items (
  isbn text not null,
  title text not null,
  normalized_title text generated always as (normalize_manga_title(title, true)) stored,
  author text,
  publisher text,
  series text,
  publication_date text,
  cover_url text,
  raw_response jsonb not null,
  last_fetched_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.publishers (
  id uuid default gen_random_uuid() not null,
  imprint_name text not null,
  publisher_name text not null
);

create table if not exists public.rakuten_import_genres (
  genre_id text not null,
  genre_name text,
  genre_level integer,
  parent_genre_id text,
  item_count integer,
  is_leaf boolean,
  next_page integer default 1 not null,
  completed_at timestamp with time zone,
  children_discovered_at timestamp with time zone,
  daily_cycle_date date,
  daily_next_page integer default 1 not null,
  daily_empty_page_count integer default 0 not null,
  last_daily_completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.rakuten_import_locks (
  lock_name text not null,
  locked_until timestamp with time zone not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.rakuten_manga_items (
  isbn text not null,
  title text not null,
  normalized_title text generated always as (normalize_manga_title(title, true)) stored,
  first_fetched_at timestamp with time zone default now() not null,
  last_fetched_at timestamp with time zone default now() not null,
  title_kana text,
  sub_title text,
  sub_title_kana text,
  series_name text,
  series_name_kana text,
  contents text,
  contents_kana text,
  author text,
  author_kana text,
  publisher_name text,
  book_size text,
  item_caption text,
  sales_date text,
  item_price integer,
  item_url text,
  affiliate_url text,
  small_image_url text,
  medium_image_url text,
  large_image_url text,
  chirayomi_url text,
  availability integer,
  postage_flag integer,
  limited_flag integer,
  review_count integer,
  review_average numeric,
  books_genre_id text,
  raw_response jsonb
);

create table if not exists public.wiki_manga_series (
  id uuid default gen_random_uuid() not null,
  title text not null,
  normalized_title text generated always as (normalize_manga_title(title, false)) stored,
  authors text,
  authors_wiki_url text,
  imprint text,
  items text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  publisher text,
  genre text
);

alter table public.agents
  add constraint agents_name_key UNIQUE (name);

alter table public.agents
  add constraint agents_pkey PRIMARY KEY (id);

alter table public.madb_manga_items
  add constraint madb_manga_items_pkey PRIMARY KEY (isbn);

alter table public.madb_manga_series
  add constraint madb_manga_series_pkey PRIMARY KEY (id);

alter table public.madb_manga_series
  add constraint madb_manga_series_title_key UNIQUE (title);

alter table public.genres
  add constraint genres_pkey PRIMARY KEY (id);

alter table public.genres
  add constraint genres_name_key UNIQUE (name);

alter table public.series
  add constraint series_pkey PRIMARY KEY (id);

alter table public.series_agents
  add constraint series_agents_pkey PRIMARY KEY (series_id, agent_id);

alter table public.series_categories
  add constraint series_categories_number_nonnegative CHECK ((category_number >= 0));

alter table public.series_categories
  add constraint series_categories_pkey PRIMARY KEY (series_id, category_number);

alter table public.series_genres
  add constraint series_genres_pkey PRIMARY KEY (series_id, genre_id);

alter table public.series_item_match_issues
  add constraint series_match_issues_title_lookup_status_check CHECK (((title_lookup_status IS NULL) OR (title_lookup_status = ANY (ARRAY['found'::text, 'not_found'::text, 'error'::text]))));

alter table public.series_item_match_issues
  add constraint series_item_match_issues_issue_type_check CHECK ((issue_type = ANY (ARRAY['unmatched'::text, 'ambiguous'::text])));

alter table public.series_item_match_issues
  add constraint series_item_match_issues_pkey PRIMARY KEY (isbn);

alter table public.series_item_unlink_logs
  add constraint series_item_unlink_logs_pkey PRIMARY KEY (id);

alter table public.series_items
  add constraint series_items_category_number_nonnegative CHECK ((category_number >= 0));

alter table public.series_items
  add constraint series_items_pkey PRIMARY KEY (isbn);

alter table public.series_items
  add constraint series_items_series_category_display_order_key UNIQUE (series_id, category_number, display_order) DEFERRABLE;

alter table public.series_publishers
  add constraint series_publishers_pkey PRIMARY KEY (series_id, publisher_id);

alter table public.openbd_manga_items
  add constraint openbd_manga_items_pkey PRIMARY KEY (isbn);

alter table public.publishers
  add constraint publishers_imprint_name_publisher_name_key UNIQUE (imprint_name, publisher_name);

alter table public.publishers
  add constraint publishers_pkey PRIMARY KEY (id);

alter table public.rakuten_import_genres
  add constraint rakuten_import_genres_daily_empty_page_count_check CHECK ((daily_empty_page_count >= 0));

alter table public.rakuten_import_genres
  add constraint rakuten_import_genres_daily_next_page_check CHECK ((daily_next_page >= 1));

alter table public.rakuten_import_genres
  add constraint rakuten_import_genres_next_page_check CHECK ((next_page >= 1));

alter table public.rakuten_import_genres
  add constraint rakuten_import_genres_pkey PRIMARY KEY (genre_id);

alter table public.rakuten_import_locks
  add constraint rakuten_import_locks_pkey PRIMARY KEY (lock_name);

alter table public.rakuten_manga_items
  add constraint rakuten_manga_items_pkey PRIMARY KEY (isbn);

alter table public.wiki_manga_series
  add constraint wiki_manga_series_pkey PRIMARY KEY (id);

alter table public.wiki_manga_series
  add constraint wiki_manga_series_title_key UNIQUE (title);

alter table public.series_agents
  add constraint series_agents_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE;

alter table public.series_agents
  add constraint series_agents_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

alter table public.series_categories
  add constraint series_categories_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

alter table public.series_genres
  add constraint series_genres_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE;

alter table public.series_genres
  add constraint series_genres_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

alter table public.series_item_match_issues
  add constraint series_item_match_issues_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.series_item_unlink_logs
  add constraint series_item_unlink_logs_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE SET NULL;

alter table public.series_item_unlink_logs
  add constraint series_item_unlink_logs_unlinked_by_fkey FOREIGN KEY (unlinked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.series_items
  add constraint series_items_matched_by_fkey FOREIGN KEY (matched_by) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public.series_items
  add constraint series_items_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

alter table public.series_publishers
  add constraint series_publishers_publisher_id_fkey FOREIGN KEY (publisher_id) REFERENCES publishers(id) ON DELETE CASCADE;

alter table public.rakuten_import_genres
  add constraint rakuten_import_genres_parent_genre_id_fkey FOREIGN KEY (parent_genre_id) REFERENCES rakuten_import_genres(genre_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS madb_manga_items_normalized_title_idx ON public.madb_manga_items USING btree (normalized_title);

CREATE INDEX IF NOT EXISTS madb_manga_series_normalized_title_idx ON public.madb_manga_series USING btree (normalized_title);

CREATE UNIQUE INDEX IF NOT EXISTS madb_manga_series_title_uidx ON public.madb_manga_series USING btree (title);

CREATE INDEX IF NOT EXISTS series_display_title_idx ON public.series USING btree (display_title);

CREATE INDEX IF NOT EXISTS series_normalized_search_title_btree_idx ON public.series USING btree (normalize_manga_title(search_title, false));

CREATE INDEX IF NOT EXISTS series_normalized_search_title_idx ON public.series USING btree (normalize_manga_title(search_title, false));

CREATE INDEX IF NOT EXISTS series_search_title_trgm_idx ON public.series USING gist (normalize_manga_title(search_title, false) extensions.gist_trgm_ops);

CREATE INDEX IF NOT EXISTS series_agents_agent_id_idx ON public.series_agents USING btree (agent_id);

CREATE INDEX IF NOT EXISTS series_agents_series_sort_order_idx ON public.series_agents USING btree (series_id, sort_order);

CREATE INDEX IF NOT EXISTS series_genres_genre_id_idx ON public.series_genres USING btree (genre_id);

CREATE INDEX IF NOT EXISTS series_match_issues_review_queue_idx ON public.series_item_match_issues USING btree (is_resolved, updated_at DESC);

CREATE INDEX IF NOT EXISTS series_match_issues_title_lookup_queue_idx ON public.series_item_match_issues USING btree (is_resolved, issue_type, title_lookup_status, isbn);

CREATE INDEX IF NOT EXISTS series_item_unlink_logs_isbn_idx ON public.series_item_unlink_logs USING btree (isbn, unlinked_at DESC);

CREATE INDEX IF NOT EXISTS series_items_series_category_idx ON public.series_items USING btree (series_id, category_number, display_order, isbn);

CREATE INDEX IF NOT EXISTS series_items_series_id_idx ON public.series_items USING btree (series_id);

CREATE INDEX IF NOT EXISTS series_publishers_publisher_id_idx ON public.series_publishers USING btree (publisher_id);

CREATE INDEX IF NOT EXISTS openbd_manga_items_normalized_title_idx ON public.openbd_manga_items USING btree (normalized_title);

CREATE INDEX IF NOT EXISTS publishers_imprint_name_idx ON public.publishers USING btree (imprint_name);

CREATE INDEX IF NOT EXISTS publishers_publisher_name_idx ON public.publishers USING btree (publisher_name);

CREATE INDEX IF NOT EXISTS rakuten_import_genres_daily_pending_idx ON public.rakuten_import_genres USING btree (is_leaf, daily_cycle_date, genre_id);

CREATE INDEX IF NOT EXISTS rakuten_import_genres_pending_discovery_idx ON public.rakuten_import_genres USING btree (children_discovered_at, genre_id);

CREATE INDEX IF NOT EXISTS rakuten_import_genres_pending_import_idx ON public.rakuten_import_genres USING btree (completed_at, genre_id);

CREATE INDEX IF NOT EXISTS rakuten_manga_items_author_idx ON public.rakuten_manga_items USING btree (author);

CREATE INDEX IF NOT EXISTS rakuten_manga_items_normalized_title_idx ON public.rakuten_manga_items USING btree (normalized_title);

CREATE INDEX IF NOT EXISTS rakuten_manga_items_title_idx ON public.rakuten_manga_items USING btree (title);

CREATE INDEX IF NOT EXISTS wiki_manga_series_normalized_title_idx ON public.wiki_manga_series USING btree (normalized_title);

alter table public.agents enable row level security;
alter table public.madb_manga_items enable row level security;
alter table public.madb_manga_series enable row level security;
alter table public.genres enable row level security;
alter table public.series enable row level security;
alter table public.series_agents enable row level security;
alter table public.series_categories enable row level security;
alter table public.series_genres enable row level security;
alter table public.series_item_match_issues enable row level security;
alter table public.series_item_unlink_logs enable row level security;
alter table public.series_items enable row level security;
alter table public.series_publishers enable row level security;
alter table public.openbd_manga_items enable row level security;
alter table public.publishers enable row level security;
alter table public.rakuten_import_genres enable row level security;
alter table public.rakuten_import_locks enable row level security;
alter table public.rakuten_manga_items enable row level security;
alter table public.wiki_manga_series enable row level security;

create policy "Public read agents"
  on public.agents
  as permissive
  for select
  to anon, authenticated
  using (true)
;

create policy "Public read manga series agents"
  on public.series_agents
  as permissive
  for select
  to anon, authenticated
  using (true)
;

create policy "Public read series publishers"
  on public.series_publishers
  as permissive
  for select
  to anon, authenticated
  using (true)
;

create policy "Public read publishers"
  on public.publishers
  as permissive
  for select
  to anon, authenticated
  using (true)
;

grant all on table public.agents to service_role;
grant all on table public.madb_manga_items to service_role;
grant all on table public.madb_manga_series to service_role;
grant all on table public.genres to service_role;
grant all on table public.series to service_role;
grant all on table public.series_agents to service_role;
grant all on table public.series_categories to service_role;
grant all on table public.series_genres to service_role;
grant all on table public.series_item_match_issues to service_role;
grant all on table public.series_item_unlink_logs to service_role;
grant all on table public.series_items to service_role;
grant all on table public.series_publishers to service_role;
grant all on table public.openbd_manga_items to service_role;
grant all on table public.publishers to service_role;
grant all on table public.rakuten_import_genres to service_role;
grant all on table public.rakuten_import_locks to service_role;
grant all on table public.rakuten_manga_items to service_role;
grant all on table public.wiki_manga_series to service_role;
grant select on table public.agents to anon, authenticated;
grant select on table public.series_agents to anon, authenticated;
grant select on table public.series_publishers to anon, authenticated;
grant select on table public.publishers to anon, authenticated;

with parsed_publishers as (
  select distinct
    btrim(imprint_token.value) as imprint_name,
    btrim(publisher_token.value) as publisher_name
  from public.wiki_manga_series as wiki
  cross join lateral regexp_split_to_table(
    coalesce(wiki.imprint, ''),
    '[,' || chr(12289) || chr(65292) || ']'
  ) as imprint_token(value)
  cross join lateral regexp_split_to_table(
    coalesce(wiki.publisher, ''),
    '[,' || chr(12289) || chr(65292) || ']'
  ) as publisher_token(value)
  where wiki.imprint is not null
    and wiki.publisher is not null
    and btrim(wiki.imprint) <> ''
    and btrim(wiki.publisher) <> ''
    and btrim(imprint_token.value) <> ''
    and btrim(publisher_token.value) <> ''
)
insert into public.publishers (
  imprint_name,
  publisher_name
)
select
  imprint_name,
  publisher_name
from parsed_publishers
on conflict (imprint_name, publisher_name) do nothing;

with parsed_series_publishers as (
  select distinct
    wiki.id as series_id,
    btrim(imprint_token.value) as imprint_name,
    btrim(publisher_token.value) as publisher_name
  from public.wiki_manga_series as wiki
  join public.series as series
    on series.id = wiki.id
  cross join lateral regexp_split_to_table(
    coalesce(wiki.imprint, ''),
    '[,' || chr(12289) || chr(65292) || ']'
  ) as imprint_token(value)
  cross join lateral regexp_split_to_table(
    coalesce(wiki.publisher, ''),
    '[,' || chr(12289) || chr(65292) || ']'
  ) as publisher_token(value)
  where wiki.imprint is not null
    and wiki.publisher is not null
    and btrim(wiki.imprint) <> ''
    and btrim(wiki.publisher) <> ''
    and btrim(imprint_token.value) <> ''
    and btrim(publisher_token.value) <> ''
)
insert into public.series_publishers (
  series_id,
  publisher_id
)
select
  parsed.series_id,
  publisher.id
from parsed_series_publishers as parsed
join public.publishers as publisher
  on publisher.imprint_name = parsed.imprint_name
 and publisher.publisher_name = parsed.publisher_name
on conflict (series_id, publisher_id) do nothing;

CREATE OR REPLACE FUNCTION public.acquire_rakuten_import_lock(p_lock_name text, p_ttl_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_acquired boolean;
begin
  insert into public.rakuten_import_locks (
    lock_name,
    locked_until,
    updated_at
  )
  values (
    p_lock_name,
    now() + make_interval(secs => greatest(1, p_ttl_seconds)),
    now()
  )
  on conflict (lock_name) do update
  set
    locked_until = excluded.locked_until,
    updated_at = excluded.updated_at
  where public.rakuten_import_locks.locked_until <= now()
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_series_item_display_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.auto_link_unresolved_match_issues_batch(p_after_isbn text DEFAULT NULL::text, p_batch_size integer DEFAULT 100, p_similarity_threshold real DEFAULT 0.83, p_min_similarity_length integer DEFAULT 4)
 RETURNS TABLE(next_isbn text, processed_count integer, linked_count integer, missing_item_count integer, unmatched_count integer, ambiguous_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
  from public.series_item_match_issues as issue
  where issue.is_resolved = false
    and (p_after_isbn is null or issue.isbn > p_after_isbn)
    and not exists (
      select 1
      from public.series_items as linked
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
  join public.series as series
    on public.normalize_manga_title(series.search_title, false)
      = item.item_normalized_title
  where item.item_normalized_title is not null;

  create temporary table auto_link_similarity_candidates on commit drop as
  select
    item.isbn,
    item.item_normalized_title,
    item.item_source,
    candidate.series_id,
    candidate.similarity_score,
    'auto_title_similarity'::text as match_method
  from auto_link_items as item
  cross join lateral (
    select
      series.id as series_id,
      similarity(
        public.normalize_manga_title(series.search_title, false),
        item.item_normalized_title
      ) as similarity_score
    from public.series as series
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
  ) as candidate
  where candidate.similarity_score >= p_similarity_threshold;

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

  insert into public.series_items (
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
  where public.series_items.match_method <> 'manual';

  get diagnostics v_linked_count = row_count;

  update public.series_item_match_issues as issue
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

  update public.series_item_match_issues as issue
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
        then 'No series search_title matched item normalized title by exact/similarity rule.'
      else 'Multiple series rows matched item normalized title by exact/similarity rule.'
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
$function$;

CREATE OR REPLACE FUNCTION public.ensure_default_series_category()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.series_categories (
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
$function$;

CREATE OR REPLACE FUNCTION public.find_similar_series(p_normalized_title text, p_limit integer DEFAULT 3)
 RETURNS TABLE(id uuid, search_title text, display_title text, similarity_score real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  select
    series.id,
    series.search_title,
    series.display_title,
    similarity(
      public.normalize_manga_title(series.search_title, false),
      public.normalize_manga_title(p_normalized_title, false)
    ) as similarity_score
  from public.series as series
  where p_normalized_title is not null
    and btrim(p_normalized_title) <> ''
  order by
    public.normalize_manga_title(series.search_title, false)
      OPERATOR(extensions.<->)
    public.normalize_manga_title(p_normalized_title, false),
    series.display_title,
    series.id
  limit greatest(1, least(p_limit, 20));
$function$;

CREATE OR REPLACE FUNCTION public.link_rakuten_manga_items()
 RETURNS TABLE(matched_count bigint, unmatched_count bigint, ambiguous_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Only one-candidate matches are linked. Manual links are never overwritten.
  with candidates as (
    select
      item.isbn,
      count(series.id)::integer as candidate_count,
      array_agg(series.id order by series.id) as candidate_series_ids
    from public.rakuten_manga_items as item
    join public.series as series
      on series.normalized_title = item.normalized_title
    group by item.isbn
  ),
  unique_candidates as (
    select
      isbn,
      candidate_series_ids[1] as series_id
    from candidates
    where candidate_count = 1
  )
  insert into public.series_items (
    isbn,
    series_id,
    match_method
  )
  select
    isbn,
    series_id,
    'normalized_title_exact'
  from unique_candidates
  on conflict (isbn) do update
  set
    series_id = excluded.series_id,
    match_method = excluded.match_method,
    updated_at = now()
  where public.series_items.match_method <> 'manual';

  -- Record titles that unexpectedly match more than one series.
  with candidates as (
    select
      item.isbn,
      item.normalized_title,
      count(series.id)::integer as candidate_count,
      array_agg(series.id order by series.id) as candidate_series_ids
    from public.rakuten_manga_items as item
    join public.series as series
      on series.normalized_title = item.normalized_title
    left join public.series_items as linked
      on linked.isbn = item.isbn
    where linked.isbn is null
    group by item.isbn, item.normalized_title
    having count(series.id) > 1
  )
  insert into public.series_item_match_issues (
    isbn,
    normalized_title,
    issue_type,
    candidate_count,
    candidate_series_ids
  )
  select
    isbn,
    normalized_title,
    'ambiguous',
    candidate_count,
    candidate_series_ids
  from candidates
  on conflict (isbn) do update
  set
    normalized_title = excluded.normalized_title,
    issue_type = excluded.issue_type,
    candidate_count = excluded.candidate_count,
    candidate_series_ids = excluded.candidate_series_ids,
    updated_at = now();

  -- Keep every currently unmatched item visible for later manual work.
  insert into public.series_item_match_issues (
    isbn,
    normalized_title,
    issue_type,
    candidate_count,
    candidate_series_ids
  )
  select
    item.isbn,
    item.normalized_title,
    'unmatched',
    0,
    '{}'
  from public.rakuten_manga_items as item
  left join public.series_items as linked
    on linked.isbn = item.isbn
  left join public.series as series
    on series.normalized_title = item.normalized_title
  where linked.isbn is null
    and series.id is null
  on conflict (isbn) do update
  set
    normalized_title = excluded.normalized_title,
    issue_type = excluded.issue_type,
    candidate_count = excluded.candidate_count,
    candidate_series_ids = excluded.candidate_series_ids,
    updated_at = now();

  delete from public.series_item_match_issues as issue
  using public.series_items as linked
  where issue.isbn = linked.isbn;

  return query
  select
    (select count(*) from public.series_items),
    (
      select count(*)
      from public.series_item_match_issues
      where issue_type = 'unmatched'
    ),
    (
      select count(*)
      from public.series_item_match_issues
      where issue_type = 'ambiguous'
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.link_rakuten_manga_items_batch(p_after_isbn text DEFAULT NULL::text, p_batch_size integer DEFAULT 500)
 RETURNS TABLE(next_isbn text, processed_count integer, matched_count integer, unmatched_count integer, ambiguous_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      from public.series_items as linked
      where linked.isbn = item.isbn
    )
    and not exists (
      select 1
      from public.series_item_match_issues as issue
      where issue.isbn = item.isbn
        and issue.is_resolved = true
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
    coalesce(
      array_agg(series.id order by series.id)
        filter (where series.id is not null),
      '{}'
    ) as candidate_series_ids
  from manga_link_batch as batch
  left join public.series as series
    on public.normalize_manga_title(series.search_title, false)
      = batch.normalized_title
  group by batch.isbn, batch.normalized_title;

  insert into public.series_items (
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
    matched_by = null,
    matched_at = now(),
    updated_at = now()
  where public.series_items.match_method <> 'manual';

  get diagnostics v_matched_count = row_count;

  insert into public.series_item_match_issues (
    isbn,
    normalized_title,
    issue_type,
    candidate_count,
    candidate_series_ids,
    is_resolved
  )
  select
    candidate.isbn,
    candidate.normalized_title,
    case
      when candidate.candidate_count = 0 then 'unmatched'
      else 'ambiguous'
    end,
    candidate.candidate_count,
    candidate.candidate_series_ids,
    candidate.isbn not like '978%'
      and candidate.isbn not like '979%'
  from manga_link_candidates as candidate
  left join public.series_items as linked
    on linked.isbn = candidate.isbn
  where linked.isbn is null
    and candidate.candidate_count <> 1
  on conflict (isbn) do update
  set
    normalized_title = excluded.normalized_title,
    issue_type = excluded.issue_type,
    candidate_count = excluded.candidate_count,
    candidate_series_ids = excluded.candidate_series_ids,
    is_resolved = public.series_item_match_issues.is_resolved
      or excluded.is_resolved,
    updated_at = now();

  delete from public.series_item_match_issues as issue
  using public.series_items as linked, manga_link_batch as batch
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
$function$;

CREATE OR REPLACE FUNCTION public.link_wiki_manga_items()
 RETURNS TABLE(parsed_count bigint, linked_count bigint, unmatched_count bigint, ambiguous_count bigint, missing_rakuten_count bigint, missing_source_count bigint, missing_series_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    series.id is not null as series_exists,
    coalesce(
      item.normalized_title,
      madb_item.normalized_title
    ) = parsed.wiki_normalized_title as title_matches
  from parsed
  left join public.rakuten_manga_items as item
    on item.isbn = parsed.isbn
  left join public.madb_manga_items as madb_item
    on madb_item.isbn = parsed.isbn
  left join public.series as series
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
    bool_or(candidate.series_exists) as series_exists,
    count(distinct candidate.series_id)
      filter (
        where candidate.title_matches
          and candidate.series_exists
      )::integer as exact_match_count,
    coalesce(
      array_agg(distinct candidate.series_id order by candidate.series_id)
        filter (
          where candidate.title_matches
            and candidate.series_exists
        ),
      '{}'
    ) as exact_series_ids,
    count(distinct candidate.series_id)::integer as source_series_count,
    array_agg(distinct candidate.series_id order by candidate.series_id)
      as source_series_ids
  from wiki_item_candidates as candidate
  group by candidate.isbn;

  insert into public.series_items (
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
  where public.series_items.match_method <> 'manual';

  get diagnostics v_linked_count = row_count;

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
      when not summary.series_exists
        then 'Wiki series UUID was not found in series.'
      when summary.exact_match_count = 0
        then 'Wiki and Rakuten normalized titles did not match.'
      else 'Multiple series matched the same ISBN.'
    end
  from wiki_item_summary as summary
  left join public.series_items as linked
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

  delete from public.series_item_match_issues as issue
  using public.series_items as linked, wiki_item_summary as summary
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
      where not series_exists
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_admin_series(p_query_text text DEFAULT NULL::text, p_exclude_empty boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, search_title text, display_title text, item_count bigint, total_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with filtered_series as (
    select
      series.id,
      series.search_title,
      series.display_title,
      count(item.isbn) as item_count
    from public.series as series
    left join public.series_items as item
      on item.series_id = series.id
    where nullif(btrim(p_query_text), '') is null
      or series.display_title ilike '%' || btrim(p_query_text) || '%'
    group by
      series.id,
      series.search_title,
      series.display_title
    having not p_exclude_empty
      or count(item.isbn) > 0
  )
  select
    filtered.id,
    filtered.search_title,
    filtered.display_title,
    filtered.item_count,
    count(*) over () as total_count
  from filtered_series as filtered
  order by filtered.display_title asc, filtered.id asc
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$function$;

CREATE OR REPLACE FUNCTION public.manual_link_manga_items(p_isbns text[], p_series_id uuid, p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.manual_unlink_manga_item(p_isbn text, p_series_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.move_series_items_to_category(p_series_id uuid, p_isbns text[], p_category_number integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_moved_count integer;
  v_category_number integer;
begin
  if p_category_number < 0 then
    raise exception 'Category number must be non-negative.';
  end if;

  if not exists (
    select 1
    from public.series_categories
    where series_id = p_series_id
      and category_number = p_category_number
  ) then
    raise exception 'Category was not found.';
  end if;

  create temporary table moved_item_categories on commit drop as
  select distinct category_number
  from public.series_items
  where series_id = p_series_id
    and isbn = any(p_isbns);

  create unique index moved_item_categories_category_number_key
    on moved_item_categories(category_number);

  update public.series_items
  set
    category_number = p_category_number,
    display_order = destination_order.next_display_order,
    updated_at = now()
  from (
    select
      moved.isbn,
      coalesce(destination.max_display_order, -1)
        + row_number() over (order by moved.display_order, moved.isbn)::integer
        as next_display_order
    from public.series_items as moved
    cross join (
      select max(display_order) as max_display_order
      from public.series_items
      where series_id = p_series_id
        and category_number = p_category_number
        and isbn <> all(p_isbns)
    ) as destination
    where moved.series_id = p_series_id
      and moved.isbn = any(p_isbns)
  ) as destination_order
  where series_items.series_id = p_series_id
    and series_items.isbn = destination_order.isbn;

  get diagnostics v_moved_count = row_count;

  insert into moved_item_categories(category_number)
  values (p_category_number)
  on conflict do nothing;

  for v_category_number in
    select category_number
    from moved_item_categories
  loop
    perform public.reorder_series_items_category(
      p_series_id,
      v_category_number
    );
  end loop;

  return v_moved_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_rakuten_import_lock(p_lock_name text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  delete from public.rakuten_import_locks
  where lock_name = p_lock_name;
$function$;

CREATE OR REPLACE FUNCTION public.reorder_series_items_category(p_series_id uuid, p_category_number integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_reordered_count integer := 0;
begin
  update public.series_items as item
  set
    display_order = -1 - ordered.next_display_order,
    updated_at = now()
  from (
    select
      isbn,
      row_number() over (
        order by
          case
            when display_order < 0 then (-1 - display_order)
            else display_order
          end,
          isbn
      )::integer - 1 as next_display_order
    from public.series_items
    where series_id = p_series_id
      and category_number = p_category_number
  ) as ordered
  where item.isbn = ordered.isbn;

  update public.series_items as item
  set
    display_order = -1 - item.display_order,
    updated_at = now()
  where item.series_id = p_series_id
    and item.category_number = p_category_number
    and item.display_order < 0;

  get diagnostics v_reordered_count = row_count;

  return v_reordered_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_series_category(p_series_id uuid, p_category_number integer, p_new_category_number integer, p_category_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_existing public.series_categories%rowtype;
begin
  if p_category_number < 0 or p_new_category_number < 0 then
    raise exception 'Category number must be non-negative.';
  end if;

  if nullif(btrim(p_category_name), '') is null then
    raise exception 'Category name is required.';
  end if;

  select *
  into v_existing
  from public.series_categories
  where series_id = p_series_id
    and category_number = p_category_number
  for update;

  if not found then
    return false;
  end if;

  if p_category_number <> p_new_category_number
    and exists (
      select 1
      from public.series_categories
      where series_id = p_series_id
        and category_number = p_new_category_number
    )
  then
    raise exception 'Category number already exists.';
  end if;

  update public.series_categories
  set
    category_number = p_new_category_number,
    category_name = btrim(p_category_name),
    updated_at = now()
  where series_id = p_series_id
    and category_number = p_category_number;

  update public.series_items
  set
    category_number = p_new_category_number,
    updated_at = now()
  where series_id = p_series_id
    and category_number = p_category_number;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_series_item_display_orders(p_series_id uuid, p_item_orders jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_updated_count integer := 0;
  v_category_number integer;
begin
  create temporary table requested_item_orders on commit drop as
  select distinct on (isbn)
    btrim(isbn) as isbn,
    category_number,
    display_order
  from jsonb_to_recordset(coalesce(p_item_orders, '[]'::jsonb))
    as item_order(isbn text, category_number integer, display_order integer)
  where btrim(isbn) <> ''
  order by isbn;

  if exists (
    select 1
    from requested_item_orders
    where category_number < 0
      or display_order < 0
  ) then
    raise exception 'Category number and display order must be non-negative.';
  end if;

  if exists (
    select 1
    from requested_item_orders as requested
    where not exists (
      select 1
      from public.series_items as item
      where item.series_id = p_series_id
        and item.isbn = requested.isbn
    )
  ) then
    raise exception 'Item was not found in the series.';
  end if;

  if exists (
    select 1
    from requested_item_orders as requested
    where not exists (
      select 1
      from public.series_categories as category
      where category.series_id = p_series_id
        and category.category_number = requested.category_number
    )
  ) then
    raise exception 'Category was not found.';
  end if;

  create temporary table affected_item_categories on commit drop as
  select distinct item.category_number
  from public.series_items as item
  join requested_item_orders as requested
    on requested.isbn = item.isbn
  where item.series_id = p_series_id
  union
  select distinct category_number
  from requested_item_orders;

  update public.series_items as item
  set
    display_order = -1000000 - numbered.row_number,
    updated_at = now()
  from (
    select
      requested.isbn,
      row_number() over (order by requested.display_order, requested.isbn)::integer
        as row_number
    from requested_item_orders as requested
  ) as numbered
  where item.series_id = p_series_id
    and item.isbn = numbered.isbn;

  update public.series_items as item
  set
    category_number = requested.category_number,
    display_order = -1 - requested.display_order,
    updated_at = now()
  from requested_item_orders as requested
  where item.series_id = p_series_id
    and item.isbn = requested.isbn;

  get diagnostics v_updated_count = row_count;

  for v_category_number in
    select category_number
    from affected_item_categories
  loop
    perform public.reorder_series_items_category(
      p_series_id,
      v_category_number
    );
  end loop;

  return v_updated_count;
end;
$function$;

drop trigger if exists series_default_category_trigger on public.series;
create trigger series_default_category_trigger
  after insert on public.series
  for each row
  execute function public.ensure_default_series_category();

drop trigger if exists series_item_display_order_trigger on public.series_items;
create trigger series_item_display_order_trigger
  before insert on public.series_items
  for each row
  execute function public.assign_series_item_display_order();

revoke all on function public.acquire_rakuten_import_lock(p_lock_name text, p_ttl_seconds integer) from public, anon, authenticated;
grant execute on function public.acquire_rakuten_import_lock(p_lock_name text, p_ttl_seconds integer) to service_role;
revoke all on function public.assign_series_item_display_order() from public, anon, authenticated;
grant execute on function public.assign_series_item_display_order() to service_role;
revoke all on function public.auto_link_unresolved_match_issues_batch(p_after_isbn text, p_batch_size integer, p_similarity_threshold real, p_min_similarity_length integer) from public, anon, authenticated;
grant execute on function public.auto_link_unresolved_match_issues_batch(p_after_isbn text, p_batch_size integer, p_similarity_threshold real, p_min_similarity_length integer) to service_role;
revoke all on function public.ensure_default_series_category() from public, anon, authenticated;
grant execute on function public.ensure_default_series_category() to service_role;
revoke all on function public.find_similar_series(p_normalized_title text, p_limit integer) from public, anon, authenticated;
grant execute on function public.find_similar_series(p_normalized_title text, p_limit integer) to service_role;
revoke all on function public.link_rakuten_manga_items() from public, anon, authenticated;
grant execute on function public.link_rakuten_manga_items() to service_role;
revoke all on function public.link_rakuten_manga_items_batch(p_after_isbn text, p_batch_size integer) from public, anon, authenticated;
grant execute on function public.link_rakuten_manga_items_batch(p_after_isbn text, p_batch_size integer) to service_role;
revoke all on function public.link_wiki_manga_items() from public, anon, authenticated;
grant execute on function public.link_wiki_manga_items() to service_role;
revoke all on function public.list_admin_series(p_query_text text, p_exclude_empty boolean, p_limit integer, p_offset integer) from public, anon, authenticated;
grant execute on function public.list_admin_series(p_query_text text, p_exclude_empty boolean, p_limit integer, p_offset integer) to service_role;
revoke all on function public.manual_link_manga_items(p_isbns text[], p_series_id uuid, p_user_id uuid) from public, anon, authenticated;
grant execute on function public.manual_link_manga_items(p_isbns text[], p_series_id uuid, p_user_id uuid) to service_role;
revoke all on function public.manual_unlink_manga_item(p_isbn text, p_series_id uuid, p_user_id uuid) from public, anon, authenticated;
grant execute on function public.manual_unlink_manga_item(p_isbn text, p_series_id uuid, p_user_id uuid) to service_role;
revoke all on function public.move_series_items_to_category(p_series_id uuid, p_isbns text[], p_category_number integer) from public, anon, authenticated;
grant execute on function public.move_series_items_to_category(p_series_id uuid, p_isbns text[], p_category_number integer) to service_role;
revoke all on function public.normalize_manga_title(input_title text, remove_volume_suffix boolean) from public, anon, authenticated;
grant execute on function public.normalize_manga_title(input_title text, remove_volume_suffix boolean) to service_role;
revoke all on function public.release_rakuten_import_lock(p_lock_name text) from public, anon, authenticated;
grant execute on function public.release_rakuten_import_lock(p_lock_name text) to service_role;
revoke all on function public.reorder_series_items_category(p_series_id uuid, p_category_number integer) from public, anon, authenticated;
grant execute on function public.reorder_series_items_category(p_series_id uuid, p_category_number integer) to service_role;
revoke all on function public.update_series_category(p_series_id uuid, p_category_number integer, p_new_category_number integer, p_category_name text) from public, anon, authenticated;
grant execute on function public.update_series_category(p_series_id uuid, p_category_number integer, p_new_category_number integer, p_category_name text) to service_role;
revoke all on function public.update_series_item_display_orders(p_series_id uuid, p_item_orders jsonb) from public, anon, authenticated;
grant execute on function public.update_series_item_display_orders(p_series_id uuid, p_item_orders jsonb) to service_role;
