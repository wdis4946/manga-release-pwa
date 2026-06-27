import type { RakutenBook } from "./types";

export type RakutenMangaItemRow = {
  isbn: string;
  title: string;
  title_kana: string | null;
  sub_title: string | null;
  sub_title_kana: string | null;
  series_name: string | null;
  series_name_kana: string | null;
  contents: string | null;
  contents_kana: string | null;
  author: string | null;
  author_kana: string | null;
  publisher_name: string | null;
  book_size: number | null;
  item_caption: string | null;
  sales_date: string | null;
  item_price: number | null;
  item_url: string | null;
  affiliate_url: string | null;
  small_image_url: string | null;
  medium_image_url: string | null;
  large_image_url: string | null;
  chirayomi_url: string | null;
  availability: number | null;
  postage_flag: number | null;
  limited_flag: number | null;
  review_count: number | null;
  review_average: number | null;
  books_genre_id: string | null;
  raw_response: RakutenBook;
  last_fetched_at: string;
};

export function toRakutenMangaItemRow(
  item: RakutenBook,
  fetchedAt: string,
): RakutenMangaItemRow | null {
  if (!item.isbn || !item.title) {
    return null;
  }

  return {
    isbn: item.isbn,
    title: item.title,
    title_kana: item.titleKana ?? null,
    sub_title: item.subTitle ?? null,
    sub_title_kana: item.subTitleKana ?? null,
    series_name: item.seriesName ?? null,
    series_name_kana: item.seriesNameKana ?? null,
    contents: item.contents ?? null,
    contents_kana: item.contentsKana ?? null,
    author: item.author ?? null,
    author_kana: item.authorKana ?? null,
    publisher_name: item.publisherName ?? null,
    book_size: item.size ?? null,
    item_caption: item.itemCaption ?? null,
    sales_date: item.salesDate ?? null,
    item_price: item.itemPrice ?? null,
    item_url: item.itemUrl ?? null,
    affiliate_url: item.affiliateUrl ?? null,
    small_image_url: item.smallImageUrl ?? null,
    medium_image_url: item.mediumImageUrl ?? null,
    large_image_url: item.largeImageUrl ?? null,
    chirayomi_url: item.chirayomiUrl ?? null,
    availability: item.availability ?? null,
    postage_flag: item.postageFlag ?? null,
    limited_flag: item.limitedFlag ?? null,
    review_count: item.reviewCount ?? null,
    review_average: item.reviewAverage ?? null,
    books_genre_id: item.booksGenreId ?? null,
    raw_response: item,
    last_fetched_at: fetchedAt,
  };
}
