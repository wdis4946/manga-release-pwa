create table if not exists public.rakuten_manga_items (
  isbn text primary key,
  title text not null,
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
  book_size integer,
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
  raw_response jsonb not null,
  series_id uuid,
  match_status text not null default 'unmatched',
  match_method text,
  first_fetched_at timestamptz not null default now(),
  last_fetched_at timestamptz not null default now()
);

create index if not exists rakuten_manga_items_title_idx
  on public.rakuten_manga_items (title);

create index if not exists rakuten_manga_items_series_name_idx
  on public.rakuten_manga_items (series_name);

create index if not exists rakuten_manga_items_series_id_idx
  on public.rakuten_manga_items (series_id);

alter table public.rakuten_manga_items enable row level security;

-- Raw provider data is server-only. The admin client uses Supabase's secret
-- key, while browser roles receive no table privileges or RLS policies.
revoke all on table public.rakuten_manga_items from anon, authenticated;
grant all on table public.rakuten_manga_items to service_role;
