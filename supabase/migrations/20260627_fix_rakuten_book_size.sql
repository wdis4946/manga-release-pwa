-- Rakuten returns a display label such as "コミック", not the numeric input
-- code used by the API's size search parameter.
alter table public.rakuten_manga_items
  alter column book_size type text
  using book_size::text;
