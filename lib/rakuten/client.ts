import type { Manga, MangaSort } from "@/lib/manga/types";
import type { RakutenBook, RakutenBooksResponse } from "./types";

const RAKUTEN_BOOKS_ENDPOINT =
  "https://app.rakuten.co.jp/services/api/BooksBook/Search/20170404";

type FetchRakutenMangaOptions = {
  sort: MangaSort;
  page?: number;
  hits?: number;
};

export async function fetchRakutenManga({
  sort,
  page = 1,
  hits = 30,
}: FetchRakutenMangaOptions): Promise<Manga[]> {
  const applicationId = process.env.RAKUTEN_APPLICATION_ID;

  if (!applicationId) {
    throw new Error("RAKUTEN_APPLICATION_ID is not configured.");
  }

  const url = buildRakutenSearchUrl({
    applicationId,
    accessKey: process.env.RAKUTEN_ACCESS_KEY,
    affiliateId: process.env.RAKUTEN_AFFILIATE_ID,
    sort,
    page,
    hits,
  });

  const response = await fetch(url, {
    // Keep Rakuten data fresh, while avoiding an external call on every request.
    next: { revalidate: 60 * 30 },
  });

  if (!response.ok) {
    throw new Error(`Rakuten Books API failed: ${response.status}`);
  }

  const data = (await response.json()) as RakutenBooksResponse;
  return (data.Items ?? []).map(toManga).filter(isCompleteManga);
}

export async function fetchRakutenMangaByIsbn(
  isbn: string,
): Promise<Manga | undefined> {
  const applicationId = process.env.RAKUTEN_APPLICATION_ID;

  if (!applicationId) {
    throw new Error("RAKUTEN_APPLICATION_ID is not configured.");
  }

  const params = createBaseParams({
    applicationId,
    accessKey: process.env.RAKUTEN_ACCESS_KEY,
    affiliateId: process.env.RAKUTEN_AFFILIATE_ID,
  });
  params.set("isbn", isbn);
  params.set("hits", "1");

  const response = await fetch(`${RAKUTEN_BOOKS_ENDPOINT}?${params}`, {
    next: { revalidate: 60 * 60 },
  });

  if (!response.ok) {
    throw new Error(`Rakuten Books API failed: ${response.status}`);
  }

  const data = (await response.json()) as RakutenBooksResponse;
  const item = data.Items?.[0];

  return item ? toManga(item) : undefined;
}

type BuildSearchUrlOptions = {
  applicationId: string;
  accessKey?: string;
  affiliateId?: string;
  sort: MangaSort;
  page: number;
  hits: number;
};

function buildRakutenSearchUrl({
  applicationId,
  accessKey,
  affiliateId,
  sort,
  page,
  hits,
}: BuildSearchUrlOptions): string {
  const params = createBaseParams({ applicationId, accessKey, affiliateId });

  // size=9 narrows Rakuten Books results to comics. App sort names are mapped
  // here so UI wording can stay independent from Rakuten's API vocabulary.
  params.set("size", "9");
  params.set("sort", sort === "popular" ? "sales" : "-releaseDate");
  params.set("hits", String(hits));
  params.set("page", String(page));

  return `${RAKUTEN_BOOKS_ENDPOINT}?${params}`;
}

function createBaseParams({
  applicationId,
  accessKey,
  affiliateId,
}: {
  applicationId: string;
  accessKey?: string;
  affiliateId?: string;
}): URLSearchParams {
  const params = new URLSearchParams({
    applicationId,
    format: "json",
    formatVersion: "2",
  });

  if (accessKey) {
    params.set("accessKey", accessKey);
  }

  if (affiliateId) {
    params.set("affiliateId", affiliateId);
  }

  return params;
}

function toManga(item: RakutenBook): Manga {
  const title = item.title ?? item.subTitle ?? "タイトル未設定";
  const rakutenUrl = item.affiliateUrl ?? item.itemUrl;

  return {
    id: item.isbn ?? encodeURIComponent(title),
    isbn: item.isbn,
    title,
    authorName: item.author ?? "作者未設定",
    description: item.itemCaption ?? "説明文はまだありません。",
    coverImageUrl:
      item.largeImageUrl ?? item.mediumImageUrl ?? item.smallImageUrl ?? "",
    genres: ["コミック"],
    popularityScore: 0,
    latestVolumeNumber: extractVolumeNumber(title),
    nextReleaseDate: normalizeSalesDate(item.salesDate),
    rakutenUrl,
    rentalUrl: `https://www.google.com/search?q=${encodeURIComponent(
      `${title} レンタル`,
    )}`,
    source: "rakuten",
  };
}

function isCompleteManga(manga: Manga): boolean {
  return Boolean(manga.title && manga.coverImageUrl);
}

function extractVolumeNumber(title: string): number {
  const match = title.match(/(?:第)?(\d+)\s*巻?/);
  return match ? Number(match[1]) : 1;
}

function normalizeSalesDate(date?: string): string | undefined {
  if (!date) {
    return undefined;
  }

  const match = date.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) {
    return undefined;
  }

  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
