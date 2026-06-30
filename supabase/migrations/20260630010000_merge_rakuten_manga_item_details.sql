begin;

-- The data copy can exceed the SQL Editor's default timeout on a large import.
set local statement_timeout = 0;

alter table public.rakuten_manga_items
  add column if not exists title_kana text,
  add column if not exists sub_title text,
  add column if not exists sub_title_kana text,
  add column if not exists series_name text,
  add column if not exists series_name_kana text,
  add column if not exists contents text,
  add column if not exists contents_kana text,
  add column if not exists author text,
  add column if not exists author_kana text,
  add column if not exists publisher_name text,
  add column if not exists book_size text,
  add column if not exists item_caption text,
  add column if not exists sales_date text,
  add column if not exists item_price integer,
  add column if not exists item_url text,
  add column if not exists affiliate_url text,
  add column if not exists small_image_url text,
  add column if not exists medium_image_url text,
  add column if not exists large_image_url text,
  add column if not exists chirayomi_url text,
  add column if not exists availability integer,
  add column if not exists postage_flag integer,
  add column if not exists limited_flag integer,
  add column if not exists review_count integer,
  add column if not exists review_average numeric,
  add column if not exists books_genre_id text,
  add column if not exists raw_response jsonb;

-- Dynamic SQL keeps this migration safe for databases created from the
-- already-merged baseline, where the detail table never existed.
do $$
declare
  detail_count bigint;
  updated_count bigint;
begin
  if to_regclass('public.rakuten_manga_item_details') is not null then
    execute 'select count(*) from public.rakuten_manga_item_details'
      into detail_count;

    execute $migration$
      update public.rakuten_manga_items as item
      set
        title_kana = detail.title_kana,
        sub_title = detail.sub_title,
        sub_title_kana = detail.sub_title_kana,
        series_name = detail.series_name,
        series_name_kana = detail.series_name_kana,
        contents = detail.contents,
        contents_kana = detail.contents_kana,
        author = detail.author,
        author_kana = detail.author_kana,
        publisher_name = detail.publisher_name,
        book_size = detail.book_size,
        item_caption = detail.item_caption,
        sales_date = detail.sales_date,
        item_price = detail.item_price,
        item_url = detail.item_url,
        affiliate_url = detail.affiliate_url,
        small_image_url = detail.small_image_url,
        medium_image_url = detail.medium_image_url,
        large_image_url = detail.large_image_url,
        chirayomi_url = detail.chirayomi_url,
        availability = detail.availability,
        postage_flag = detail.postage_flag,
        limited_flag = detail.limited_flag,
        review_count = detail.review_count,
        review_average = detail.review_average,
        books_genre_id = detail.books_genre_id,
        raw_response = detail.raw_response,
        last_fetched_at = greatest(
          item.last_fetched_at,
          detail.last_fetched_at
        )
      from public.rakuten_manga_item_details as detail
      where detail.isbn = item.isbn
    $migration$;

    get diagnostics updated_count = row_count;

    if updated_count <> detail_count then
      raise exception
        'Detail copy count mismatch: expected %, updated %',
        detail_count,
        updated_count;
    end if;

    execute 'drop table public.rakuten_manga_item_details';
  end if;
end;
$$;

create index if not exists rakuten_manga_items_author_idx
  on public.rakuten_manga_items(author);

commit;
