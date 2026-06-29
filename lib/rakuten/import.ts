import type { RakutenBook } from "./types";

export type RakutenMangaItemRow = {
  isbn: string;
  title: string;
  last_fetched_at: string;
};

export type RakutenMangaItemDetailRow = {
  isbn: string;
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
  book_size: string | null;
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
    last_fetched_at: fetchedAt,
  };
}

export function toRakutenMangaItemDetailRow(
  item: RakutenBook,
  fetchedAt: string,
): RakutenMangaItemDetailRow | null {
  if (!item.isbn || !item.title) {
    return null;
  }

  return {
    isbn: item.isbn,
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
    book_size: toNullableText(item.size),
    item_caption: item.itemCaption ?? null,
    sales_date: item.salesDate ?? null,
    item_price: toNullableInteger(item.itemPrice),
    item_url: item.itemUrl ?? null,
    affiliate_url: item.affiliateUrl ?? null,
    small_image_url: item.smallImageUrl ?? null,
    medium_image_url: item.mediumImageUrl ?? null,
    large_image_url: item.largeImageUrl ?? null,
    chirayomi_url: item.chirayomiUrl ?? null,
    availability: toNullableInteger(item.availability),
    postage_flag: toNullableInteger(item.postageFlag),
    limited_flag: toNullableInteger(item.limitedFlag),
    review_count: toNullableInteger(item.reviewCount),
    review_average: toNullableNumber(item.reviewAverage),
    books_genre_id: item.booksGenreId ?? null,
    raw_response: item,
    last_fetched_at: fetchedAt,
  };
}

function toNullableText(value: string | number | undefined): string | null {
  if (value === undefined || value === "") {
    return null;
  }

  return String(value);
}

function toNullableInteger(value: string | number | undefined): number | null {
  const number = toNullableNumber(value);
  return number === null ? null : Math.trunc(number);
}

function toNullableNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
