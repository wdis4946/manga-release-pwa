import type { Manga, MangaSort } from "@/lib/manga/types";
import type {
  RakutenBook,
  RakutenBooksGenreResponse,
  RakutenBooksResponse,
} from "./types";

const RAKUTEN_BOOKS_ENDPOINT =
  "https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404";
const RAKUTEN_BOOKS_GENRE_ENDPOINT =
  "https://openapi.rakuten.co.jp/services/api/BooksGenre/Search/20121128";

type FetchRakutenMangaOptions = {
  sort: MangaSort;
  page?: number;
  hits?: number;
  booksGenreId?: string;
  includeSize?: boolean;
};

export type RakutenBookPage = {
  items: RakutenBook[];
  page: number;
  pageCount: number;
  count: number;
};

export async function fetchRakutenBookPage({
  sort,
  page = 1,
  hits = 30,
  booksGenreId,
  includeSize = true,
}: FetchRakutenMangaOptions): Promise<RakutenBookPage> {
  const credentials = getRakutenCredentials();
  const url = new URL(
    buildRakutenSearchUrl({
      ...credentials,
      sort,
      page,
      hits,
      booksGenreId,
      includeSize,
    }),
  );

  // The import captures unavailable items too, so the local snapshot is not
  // limited to products that happen to be purchasable at import time.
  url.searchParams.set("outOfStockFlag", "1");

  const response = await fetchRakutenWithRetry(url, {
    headers: createRakutenRequestHeaders(),
    cache: "no-store",
  });

  const data = (await response.json()) as RakutenBooksResponse;

  return {
    items: data.Items ?? [],
    page: data.page ?? page,
    pageCount: data.pageCount ?? 0,
    count: data.count ?? 0,
  };
}

export async function fetchRakutenManga({
  sort,
  page = 1,
  hits = 30,
}: FetchRakutenMangaOptions): Promise<Manga[]> {
  const credentials = getRakutenCredentials();

  const url = buildRakutenSearchUrl({
    ...credentials,
    sort,
    page,
    hits,
  });

  const response = await fetchRakutenWithRetry(url, {
    headers: createRakutenRequestHeaders(),
    // Keep Rakuten data fresh, while avoiding an external call on every request.
    next: { revalidate: 60 * 30 },
  });

  const data = (await response.json()) as RakutenBooksResponse;
  return (data.Items ?? []).map(toManga).filter(isCompleteManga);
}

export async function fetchRakutenMangaByIsbn(
  isbn: string,
): Promise<Manga | undefined> {
  const credentials = getRakutenCredentials();

  const params = createBaseParams(credentials);
  params.set("isbn", isbn);
  params.set("hits", "1");
  params.set("outOfStockFlag", "1");

  const response = await fetchRakutenWithRetry(
    `${RAKUTEN_BOOKS_ENDPOINT}?${params}`,
    {
      headers: createRakutenRequestHeaders(),
      next: { revalidate: 60 * 60 },
    },
  );

  const data = (await response.json()) as RakutenBooksResponse;
  const item = data.Items?.[0];

  return item ? toManga(item) : undefined;
}

export async function fetchRakutenBooksGenreNames(
  booksGenreIds: string[],
): Promise<string[]> {
  const uniqueGenreIds = Array.from(new Set(booksGenreIds)).filter(Boolean);

  if (uniqueGenreIds.length === 0) {
    return [];
  }

  const genreNames = await Promise.all(
    uniqueGenreIds.map((booksGenreId) => fetchRakutenBooksGenreName(booksGenreId)),
  );

  return Array.from(new Set(genreNames.filter(isString)));
}

export async function fetchRakutenBooksGenre(
  booksGenreId: string,
): Promise<RakutenBooksGenreResponse> {
  const credentials = getRakutenCredentials();
  const params = createBaseParams(credentials);
  params.set("booksGenreId", booksGenreId);

  const response = await fetchRakutenWithRetry(
    `${RAKUTEN_BOOKS_GENRE_ENDPOINT}?${params}`,
    {
      headers: createRakutenRequestHeaders(),
      cache: "no-store",
    },
  );

  return (await response.json()) as RakutenBooksGenreResponse;
}

type BuildSearchUrlOptions = {
  applicationId: string;
  accessKey: string;
  affiliateId?: string;
  sort: MangaSort;
  page: number;
  hits: number;
  booksGenreId?: string;
  includeSize?: boolean;
};

function buildRakutenSearchUrl({
  applicationId,
  accessKey,
  affiliateId,
  sort,
  page,
  hits,
  booksGenreId,
  includeSize = true,
}: BuildSearchUrlOptions): string {
  const params = createBaseParams({ applicationId, accessKey, affiliateId });

  if (includeSize) {
    // size=9 narrows Rakuten Books results to comics. App sort names are mapped
    // here so UI wording can stay independent from Rakuten's API vocabulary.
    params.set("size", "9");
  }
  params.set("sort", sort === "popular" ? "sales" : "-releaseDate");
  params.set("hits", String(hits));
  params.set("page", String(page));

  if (booksGenreId) {
    params.set("booksGenreId", booksGenreId);
  }

  return `${RAKUTEN_BOOKS_ENDPOINT}?${params}`;
}

function createBaseParams({
  applicationId,
  accessKey,
  affiliateId,
}: {
  applicationId: string;
  accessKey: string;
  affiliateId?: string;
}): URLSearchParams {
  const params = new URLSearchParams({
    applicationId,
    format: "json",
    formatVersion: "2",
  });

  params.set("accessKey", accessKey);

  if (affiliateId) {
    params.set("affiliateId", affiliateId);
  }

  return params;
}

async function fetchRakutenBooksGenreName(
  booksGenreId: string,
): Promise<string | undefined> {
  const data = await fetchRakutenBooksGenre(booksGenreId);
  return data.current?.booksGenreName;
}

function getRakutenCredentials(): {
  applicationId: string;
  accessKey: string;
  affiliateId?: string;
} {
  const applicationId = process.env.RAKUTEN_APPLICATION_ID;
  const accessKey = process.env.RAKUTEN_ACCESS_KEY;

  if (!applicationId || !accessKey) {
    throw new Error(
      "Rakuten credentials are not configured. Set RAKUTEN_APPLICATION_ID and RAKUTEN_ACCESS_KEY.",
    );
  }

  return {
    applicationId,
    accessKey,
    affiliateId: process.env.RAKUTEN_AFFILIATE_ID,
  };
}

function createRakutenRequestHeaders(): HeadersInit {
  const appOrigin = process.env.APP_ORIGIN;

  if (!appOrigin) {
    throw new Error(
      "APP_ORIGIN is not configured. Set it to your allowed website origin, for example https://manga-release-pwa.vercel.app.",
    );
  }

  const origin = appOrigin.replace(/\/+$/, "");

  return {
    Origin: origin,
    Referer: `${origin}/`,
  };
}

async function fetchRakutenWithRetry(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(input, init);

    if (response.ok) {
      return response;
    }

    const body = await response.text();

    if (response.status !== 429 || attempt === maxAttempts) {
      throw new Error(
        `Rakuten Books API failed: ${response.status} ${body || response.statusText}`,
      );
    }

    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const retryAfterMs = Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1000
      : 0;
    const exponentialBackoffMs = 1000 * 2 ** (attempt - 1);
    const waitMs =
      Math.max(retryAfterMs, exponentialBackoffMs) +
      Math.floor(Math.random() * 250);

    console.warn("[Rakuten API] Rate limited; retrying.", {
      attempt,
      waitMs,
    });
    await delay(waitMs);
  }

  throw new Error("Rakuten Books API retry loop ended unexpectedly.");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    genres: parseBooksGenreIds(item.booksGenreId),
    popularityScore: 0,
    latestVolumeNumber: extractVolumeNumber(title),
    nextReleaseDate: normalizeSalesDate(item.salesDate),
    rakutenUrl,
    rentalUrl: `https://www.google.com/search?q=${encodeURIComponent(
      `${title} レンタル`,
    )}`,
    source: "rakuten",
    // Preserve the complete response item so newly available API fields can be
    // inspected without adding each one to the UI-oriented Manga type.
    rawApiData: item,
  };
}

function isCompleteManga(manga: Manga): boolean {
  return Boolean(manga.title && manga.coverImageUrl);
}

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseBooksGenreIds(booksGenreId?: string): string[] {
  if (!booksGenreId) {
    return [];
  }

  return booksGenreId
    .split("/")
    .map((genreId) => genreId.trim())
    .filter(Boolean);
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
