import {
  fetchRakutenBookByIsbn,
  fetchRakutenBooksGenreNames,
  fetchRakutenManga,
  fetchRakutenMangaByIsbn,
} from "@/lib/rakuten/client";
import { SERIES_COVERS_BUCKET } from "@/lib/admin/series-cover-url";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getFilteredManga, getMangaById } from "./filters";
import { mangaList } from "./mock-data";
import type { Manga, MangaFilters, MangaSort } from "./types";

export const PUBLIC_GALLERY_PAGE_SIZE = 25;
const MAX_PUBLIC_GALLERY_LIMIT = 50;
const SUGGESTION_LIMIT = 40;

type PublicGalleryFilters = {
  query?: string;
  tag?: string;
  author?: string;
  limit?: number;
  excludeIds?: string[];
};

type SearchSuggestion = {
  id: string;
  name: string;
};

type SeriesRow = {
  id: string;
  display_title: string;
  search_title: string;
  description: string | null;
  representative_image_path: string | null;
};

type DisplayGroupRow = {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
};

type DisplayGroupSeriesRow = {
  display_group_id: string;
  series_id: string;
  sort_order: number;
};

type SeriesCategoryRow = {
  category_number: number;
  category_name: string;
};

type SeriesItemLinkRow = {
  isbn: string;
  category_number: number;
  display_order: number;
};

type RakutenMangaItemRow = {
  isbn: string;
  title: string | null;
  sales_date: string | null;
  large_image_url: string | null;
  medium_image_url: string | null;
  item_url: string | null;
};

export type PublicMangaDisplayGroup = {
  id: string;
  name: string;
  description: string | null;
  manga: Manga[];
};

export type PublicSeriesVolumePreview = {
  isbn: string;
  label: string;
  displayOrder: number;
  title: string;
  coverImageUrl: string | null;
  itemUrl: string | null;
  salesDate: string | null;
};

export type PublicSeriesCategory = {
  categoryNumber: number;
  categoryName: string;
  itemCount: number;
  volumes: PublicSeriesVolumePreview[];
};

export type PublicSeriesDetail = {
  id: string;
  title: string;
  searchTitle: string;
  description: string;
  representativeImageUrl: string;
  authors: string[];
  genres: string[];
  publishers: string[];
  categories: PublicSeriesCategory[];
};

export async function getMangaForList(
  filters: MangaFilters,
): Promise<{ manga: Manga[]; source: "rakuten" | "mock" }> {
  const sort = normalizeSort(filters.sort);

  try {
    const rakutenManga = await fetchRakutenManga({ sort });

    if (rakutenManga.length > 0) {
      return {
        manga: applyLocalFilters(rakutenManga, filters),
        source: "rakuten",
      };
    }
  } catch (error) {
    console.warn("Falling back to mock manga list.", error);
  }

  return { manga: getFilteredManga({ ...filters, sort }), source: "mock" };
}

export async function getMangaDetail(id: string): Promise<Manga | undefined> {
  const seriesManga = await getSeriesMangaDetail(id);

  if (seriesManga) {
    return seriesManga;
  }

  const mockManga = getMangaById(id);

  if (mockManga) {
    return mockManga;
  }

  try {
    return await fetchRakutenMangaByIsbn(id);
  } catch (error) {
    console.warn("Falling back to mock manga detail.", error);
    return mangaList.find((manga) => manga.isbn === id);
  }
}

export async function getMangaGenreNames(manga: Manga): Promise<string[]> {
  if (manga.source !== "rakuten") {
    return manga.genres;
  }

  try {
    return await fetchRakutenBooksGenreNames(manga.genres);
  } catch (error) {
    console.warn("Falling back to hidden genre names.", error);
    return [];
  }
}

export function normalizeSort(sort?: MangaSort): MangaSort {
  return sort === "latest" ? "latest" : "popular";
}

export async function getPublicMangaSeriesGallery(
  filters: PublicGalleryFilters = {},
): Promise<{ manga: Manga[]; source: "series" }> {
  const supabase = createSupabaseAdminClient();
  const matchingSeriesIds = await resolvePublicGallerySeriesIds(filters);
  const limit = clampPublicGalleryLimit(filters.limit);
  const excludedIds = normalizeUuidList(filters.excludeIds ?? []);

  if (matchingSeriesIds && matchingSeriesIds.length === 0) {
    return { manga: [], source: "series" };
  }

  let query = supabase
    .from("series")
    .select(
      "id, display_title, search_title, description, representative_image_path",
    )
    .not("representative_image_path", "is", null)
    .neq("representative_image_path", "")
    .limit(Math.min(Math.max(limit * 6, 200), 500));

  const queryText = filters.query?.trim();

  if (queryText) {
    query = query.ilike("display_title", `%${escapeIlikeValue(queryText)}%`);
  }

  if (matchingSeriesIds) {
    query = query.in("id", matchingSeriesIds);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[Public manga] Failed to load series gallery.", error);
    return { manga: [], source: "series" };
  }

  const excludedIdSet = new Set(excludedIds);
  const rows = shuffle((data ?? []) as SeriesRow[])
    .filter((row) => !excludedIdSet.has(row.id))
    .slice(0, limit);
  const manga = rows.flatMap((row) => {
    const coverImageUrl = createPublicSeriesCoverUrl(
      supabase,
      row.representative_image_path,
    );

    if (!coverImageUrl) {
      return [];
    }

    return [toSeriesManga(row, coverImageUrl)];
  });

  return { manga, source: "series" };
}

export async function getPublicMangaDisplayGroups(): Promise<
  PublicMangaDisplayGroup[]
> {
  const supabase = createSupabaseAdminClient();

  try {
    const { data: groups, error: groupsError } = await supabase
      .from("display_groups")
      .select("id, name, description, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (groupsError) {
      throw groupsError;
    }

    const groupRows = (groups ?? []) as DisplayGroupRow[];
    const groupIds = groupRows.map((group) => group.id);

    if (groupIds.length === 0) {
      return [];
    }

    const { data: links, error: linksError } = await supabase
      .from("display_group_series")
      .select("display_group_id, series_id, sort_order")
      .in("display_group_id", groupIds)
      .order("sort_order", { ascending: true })
      .order("series_id", { ascending: true });

    if (linksError) {
      throw linksError;
    }

    const linkRows = (links ?? []) as DisplayGroupSeriesRow[];
    const seriesIds = [...new Set(linkRows.map((link) => link.series_id))];

    if (seriesIds.length === 0) {
      return [];
    }

    const { data: series, error: seriesError } = await supabase
      .from("series")
      .select(
        "id, display_title, search_title, description, representative_image_path",
      )
      .in("id", seriesIds)
      .not("representative_image_path", "is", null)
      .neq("representative_image_path", "");

    if (seriesError) {
      throw seriesError;
    }

    const seriesById = new Map(
      ((series ?? []) as SeriesRow[]).map((row) => [row.id, row]),
    );
    const linksByGroupId = new Map<string, DisplayGroupSeriesRow[]>();

    for (const link of linkRows) {
      const groupLinks = linksByGroupId.get(link.display_group_id) ?? [];
      groupLinks.push(link);
      linksByGroupId.set(link.display_group_id, groupLinks);
    }

    return groupRows.flatMap((group) => {
      const manga = (linksByGroupId.get(group.id) ?? []).flatMap((link) => {
        const row = seriesById.get(link.series_id);
        const coverImageUrl = createPublicSeriesCoverUrl(
          supabase,
          row?.representative_image_path,
        );

        if (!row || !coverImageUrl) {
          return [];
        }

        return [toSeriesManga(row, coverImageUrl)];
      });

      if (manga.length === 0) {
        return [];
      }

      return [
        {
          id: group.id,
          name: group.name,
          description: group.description,
          manga,
        },
      ];
    });
  } catch (error) {
    console.error("[Public manga] Failed to load display groups.", error);
    return [];
  }
}

export async function getPublicSeriesDetail(
  id: string,
): Promise<PublicSeriesDetail | null> {
  const supabase = createSupabaseAdminClient();
  const { data: series, error } = await supabase
    .from("series")
    .select(
      "id, display_title, search_title, description, representative_image_path",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[Public manga] Failed to load public series detail.", {
      id,
      error,
    });
    return null;
  }

  if (!series) {
    return null;
  }

  const row = series as SeriesRow;
  const representativeImageUrl = createPublicSeriesCoverUrl(
    supabase,
    row.representative_image_path,
  );

  if (!representativeImageUrl) {
    return null;
  }

  const [authors, genres, publishers, categories, links] = await Promise.all([
    fetchAgentNamesBySeriesIds([id]),
    fetchGenreNamesBySeriesIds([id]),
    fetchPublisherNamesBySeriesIds([id]),
    fetchSeriesCategories(id),
    fetchSeriesItemLinks(id),
  ]);

  return {
    id: row.id,
    title: row.display_title,
    searchTitle: row.search_title,
    description: row.description ?? "",
    representativeImageUrl,
    authors: authors.get(id) ?? [],
    genres: genres.get(id) ?? [],
    publishers: publishers.get(id) ?? [],
    categories: await buildPublicSeriesCategories(categories, links),
  };
}

export async function getPublicSearchSuggestions(): Promise<{
  tags: SearchSuggestion[];
  authors: SearchSuggestion[];
}> {
  const supabase = createSupabaseAdminClient();
  const [genresResult, agentsResult] = await Promise.all([
    supabase
      .from("genres")
      .select("id, name")
      .order("name", { ascending: true })
      .limit(SUGGESTION_LIMIT),
    supabase
      .from("agents")
      .select("id, name")
      .order("name", { ascending: true })
      .limit(SUGGESTION_LIMIT),
  ]);

  if (genresResult.error) {
    console.error("[Public manga] Failed to load tag suggestions.", {
      error: genresResult.error,
    });
  }

  if (agentsResult.error) {
    console.error("[Public manga] Failed to load author suggestions.", {
      error: agentsResult.error,
    });
  }

  return {
    tags: ((genresResult.data ?? []) as SearchSuggestion[]).filter(
      (tag) => tag.name,
    ),
    authors: ((agentsResult.data ?? []) as SearchSuggestion[]).filter(
      (author) => author.name,
    ),
  };
}

function applyLocalFilters(manga: Manga[], filters: MangaFilters): Manga[] {
  return manga.filter((item) => {
    const matchesGenre = filters.genre
      ? item.genres.includes(filters.genre)
      : true;
    const matchesAuthor = filters.author
      ? item.authorName.includes(filters.author)
      : true;

    return matchesGenre && matchesAuthor;
  });
}

async function getSeriesMangaDetail(id: string): Promise<Manga | undefined> {
  const supabase = createSupabaseAdminClient();
  const { data: series, error } = await supabase
    .from("series")
    .select(
      "id, display_title, search_title, description, representative_image_path",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[Public manga] Failed to load series detail.", { id, error });
    return undefined;
  }

  if (!series) {
    return undefined;
  }

  const [agents, genres, itemCount] = await Promise.all([
    fetchAgentNamesBySeriesIds([id]),
    fetchGenreNamesBySeriesIds([id]),
    countSeriesItems(id),
  ]);
  const coverImageUrl =
    createPublicSeriesCoverUrl(
      supabase,
      (series as SeriesRow).representative_image_path,
    ) ?? "https://placehold.co/420x640?text=Manga";

  return toSeriesManga(series as SeriesRow, coverImageUrl, {
    authorName: agents.get(id)?.join("、") ?? "",
    genres: genres.get(id) ?? [],
    latestVolumeNumber: itemCount,
  });
}

async function resolvePublicGallerySeriesIds({
  tag,
  author,
}: PublicGalleryFilters): Promise<string[] | null> {
  const normalizedTag = tag?.trim();
  const normalizedAuthor = author?.trim();

  if (!normalizedTag && !normalizedAuthor) {
    return null;
  }

  const idSets: Set<string>[] = [];

  if (normalizedTag) {
    const genreIds = await resolveGenreIds(normalizedTag);
    const seriesIds = await resolveSeriesIdsByGenreIds(genreIds);
    idSets.push(new Set(seriesIds));
  }

  if (normalizedAuthor) {
    const agentIds = await resolveAgentIds(normalizedAuthor);
    const seriesIds = await resolveSeriesIdsByAgentIds(agentIds);
    idSets.push(new Set(seriesIds));
  }

  if (idSets.length === 0) {
    return null;
  }

  return [...idSets[0]].filter((id) =>
    idSets.every((idSet) => idSet.has(id)),
  );
}

async function resolveGenreIds(name: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("genres")
    .select("id")
    .ilike("name", `%${escapeIlikeValue(name)}%`);

  if (error) {
    console.error("[Public manga] Failed to resolve genres.", { name, error });
    return [];
  }

  return (data ?? []).map((row) => row.id as string);
}

async function resolveAgentIds(name: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("agents")
    .select("id")
    .ilike("name", `%${escapeIlikeValue(name)}%`);

  if (error) {
    console.error("[Public manga] Failed to resolve agents.", { name, error });
    return [];
  }

  return (data ?? []).map((row) => row.id as string);
}

async function resolveSeriesIdsByGenreIds(genreIds: string[]) {
  if (genreIds.length === 0) {
    return [];
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("series_genres")
    .select("series_id")
    .in("genre_id", genreIds);

  if (error) {
    console.error("[Public manga] Failed to resolve series by genres.", error);
    return [];
  }

  return [...new Set((data ?? []).map((row) => row.series_id as string))];
}

async function resolveSeriesIdsByAgentIds(agentIds: string[]) {
  if (agentIds.length === 0) {
    return [];
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("series_agents")
    .select("series_id")
    .in("agent_id", agentIds);

  if (error) {
    console.error("[Public manga] Failed to resolve series by agents.", error);
    return [];
  }

  return [...new Set((data ?? []).map((row) => row.series_id as string))];
}

async function fetchAgentNamesBySeriesIds(seriesIds: string[]) {
  const supabase = createSupabaseAdminClient();
  const namesBySeriesId = new Map<string, string[]>();

  if (seriesIds.length === 0) {
    return namesBySeriesId;
  }

  const { data, error } = await supabase
    .from("series_agents")
    .select("series_id, sort_order, agents(name)")
    .in("series_id", seriesIds)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[Public manga] Failed to load series agents.", error);
    return namesBySeriesId;
  }

  for (const row of data ?? []) {
    const agent = firstRelation<{ name: string }>(row.agents);

    if (!agent?.name) {
      continue;
    }

    const names = namesBySeriesId.get(row.series_id) ?? [];
    names.push(agent.name);
    namesBySeriesId.set(row.series_id, names);
  }

  return namesBySeriesId;
}

async function fetchGenreNamesBySeriesIds(seriesIds: string[]) {
  const supabase = createSupabaseAdminClient();
  const namesBySeriesId = new Map<string, string[]>();

  if (seriesIds.length === 0) {
    return namesBySeriesId;
  }

  const { data, error } = await supabase
    .from("series_genres")
    .select("series_id, genres(name)")
    .in("series_id", seriesIds);

  if (error) {
    console.error("[Public manga] Failed to load series genres.", error);
    return namesBySeriesId;
  }

  for (const row of data ?? []) {
    const genre = firstRelation<{ name: string }>(row.genres);

    if (!genre?.name) {
      continue;
    }

    const names = namesBySeriesId.get(row.series_id) ?? [];
    names.push(genre.name);
    namesBySeriesId.set(row.series_id, names);
  }

  return namesBySeriesId;
}

async function fetchPublisherNamesBySeriesIds(seriesIds: string[]) {
  const supabase = createSupabaseAdminClient();
  const namesBySeriesId = new Map<string, string[]>();

  if (seriesIds.length === 0) {
    return namesBySeriesId;
  }

  const { data, error } = await supabase
    .from("series_publishers")
    .select("series_id, publishers(imprint_name, publisher_name)")
    .in("series_id", seriesIds);

  if (error) {
    console.error("[Public manga] Failed to load series publishers.", error);
    return namesBySeriesId;
  }

  for (const row of data ?? []) {
    const publisher = firstRelation<{
      imprint_name: string | null;
      publisher_name: string | null;
    }>(row.publishers);
    const name = publisher?.imprint_name || publisher?.publisher_name;

    if (!name) {
      continue;
    }

    const names = namesBySeriesId.get(row.series_id) ?? [];
    if (!names.includes(name)) {
      names.push(name);
    }
    namesBySeriesId.set(row.series_id, names);
  }

  return namesBySeriesId;
}

async function fetchSeriesCategories(seriesId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("series_categories")
    .select("category_number, category_name")
    .eq("series_id", seriesId)
    .order("category_number", { ascending: true });

  if (error) {
    console.error("[Public manga] Failed to load series categories.", {
      seriesId,
      error,
    });
    return [];
  }

  return (data ?? []) as SeriesCategoryRow[];
}

async function fetchSeriesItemLinks(seriesId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("series_items")
    .select("isbn, category_number, display_order")
    .eq("series_id", seriesId)
    .order("category_number", { ascending: true })
    .order("display_order", { ascending: true })
    .order("isbn", { ascending: true });

  if (error) {
    console.error("[Public manga] Failed to load series item links.", {
      seriesId,
      error,
    });
    return [];
  }

  return (data ?? []) as SeriesItemLinkRow[];
}

async function buildPublicSeriesCategories(
  categories: SeriesCategoryRow[],
  links: SeriesItemLinkRow[],
): Promise<PublicSeriesCategory[]> {
  const linksByCategory = new Map<number, SeriesItemLinkRow[]>();
  const rakutenItemsByIsbn = await fetchRakutenMangaItemRows(
    links.map((link) => link.isbn),
  );

  for (const link of links) {
    const categoryLinks = linksByCategory.get(link.category_number) ?? [];
    categoryLinks.push(link);
    linksByCategory.set(link.category_number, categoryLinks);
  }

  const categoryNumbers = new Set([
    ...categories.map((category) => category.category_number),
    ...links.map((link) => link.category_number),
  ]);
  const namesByNumber = new Map(
    categories.map((category) => [
      category.category_number,
      category.category_name,
    ]),
  );

  const result = await Promise.all(
    [...categoryNumbers]
      .sort((left, right) => left - right)
      .map(async (categoryNumber) => {
        const categoryLinks = [...(linksByCategory.get(categoryNumber) ?? [])].sort(
          (left, right) =>
            left.display_order - right.display_order ||
            left.isbn.localeCompare(right.isbn),
        );

        return {
          categoryNumber,
          categoryName: namesByNumber.get(categoryNumber) ?? "単行本",
          itemCount: categoryLinks.length,
          volumes: await Promise.all(
            categoryLinks.map((link, index) =>
              fetchPublicSeriesVolumePreview(
                link,
                index,
                rakutenItemsByIsbn.get(link.isbn),
              ),
            ),
          ),
        };
      }),
  );

  return result;
}

async function fetchRakutenMangaItemRows(
  isbns: string[],
): Promise<Map<string, RakutenMangaItemRow>> {
  const supabase = createSupabaseAdminClient();
  const uniqueIsbns = [...new Set(isbns.filter(Boolean))];
  const rowsByIsbn = new Map<string, RakutenMangaItemRow>();

  for (let index = 0; index < uniqueIsbns.length; index += 200) {
    const chunk = uniqueIsbns.slice(index, index + 200);
    const { data, error } = await supabase
      .from("rakuten_manga_items")
      .select(
        "isbn, title, sales_date, large_image_url, medium_image_url, item_url",
      )
      .in("isbn", chunk);

    if (error) {
      console.error("[Public manga] Failed to load Rakuten manga item rows.", {
        error,
      });
      continue;
    }

    for (const row of (data ?? []) as RakutenMangaItemRow[]) {
      rowsByIsbn.set(row.isbn, row);
    }
  }

  return rowsByIsbn;
}

async function fetchPublicSeriesVolumePreview(
  link: SeriesItemLinkRow,
  index: number,
  rakutenItem?: RakutenMangaItemRow,
): Promise<PublicSeriesVolumePreview> {
  const fallbackPreview: PublicSeriesVolumePreview = {
    isbn: link.isbn,
    label: `${index + 1}巻`,
    displayOrder: link.display_order,
    title: rakutenItem?.title ?? link.isbn,
    coverImageUrl:
      rakutenItem?.large_image_url ?? rakutenItem?.medium_image_url ?? null,
    itemUrl: rakutenItem?.item_url ?? null,
    salesDate: rakutenItem?.sales_date ?? null,
  };

  if (fallbackPreview.coverImageUrl) {
    return fallbackPreview;
  }

  try {
    const book = await fetchRakutenBookByIsbn(link.isbn);

    return {
      isbn: link.isbn,
      label: fallbackPreview.label,
      displayOrder: link.display_order,
      title: book?.title ?? fallbackPreview.title,
      coverImageUrl:
        book?.largeImageUrl ??
        book?.mediumImageUrl ??
        book?.smallImageUrl ??
        fallbackPreview.coverImageUrl,
      itemUrl: book?.affiliateUrl ?? book?.itemUrl ?? fallbackPreview.itemUrl,
      salesDate: book?.salesDate ?? fallbackPreview.salesDate,
    };
  } catch (error) {
    console.warn("[Public manga] Failed to load Rakuten volume preview.", {
      isbn: link.isbn,
      error,
    });

    return {
      isbn: link.isbn,
      label: fallbackPreview.label,
      displayOrder: link.display_order,
      title: fallbackPreview.title,
      coverImageUrl: fallbackPreview.coverImageUrl,
      itemUrl: fallbackPreview.itemUrl,
      salesDate: fallbackPreview.salesDate,
    };
  }
}

async function countSeriesItems(seriesId: string) {
  const supabase = createSupabaseAdminClient();
  const { count, error } = await supabase
    .from("series_items")
    .select("isbn", { count: "exact", head: true })
    .eq("series_id", seriesId);

  if (error) {
    console.error("[Public manga] Failed to count series items.", {
      seriesId,
      error,
    });
    return 0;
  }

  return count ?? 0;
}

function createPublicSeriesCoverUrl(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  path: string | null | undefined,
) {
  if (!path) {
    return null;
  }

  return supabase.storage.from(SERIES_COVERS_BUCKET).getPublicUrl(path).data
    .publicUrl;
}

function toSeriesManga(
  series: SeriesRow,
  coverImageUrl: string,
  options: {
    authorName?: string;
    genres?: string[];
    latestVolumeNumber?: number;
  } = {},
): Manga {
  return {
    id: series.id,
    title: series.display_title,
    authorName: options.authorName ?? "",
    description: series.description ?? "",
    coverImageUrl,
    genres: options.genres ?? [],
    popularityScore: 0,
    latestVolumeNumber: options.latestVolumeNumber ?? 0,
    source: "series",
  };
}

function shuffle<T>(items: T[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function escapeIlikeValue(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function clampPublicGalleryLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) {
    return PUBLIC_GALLERY_PAGE_SIZE;
  }

  return Math.min(
    Math.max(Math.trunc(limit ?? PUBLIC_GALLERY_PAGE_SIZE), 1),
    MAX_PUBLIC_GALLERY_LIMIT,
  );
}

function normalizeUuidList(values: string[]) {
  return [
    ...new Set(
      values.filter((value) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value,
        ),
      ),
    ),
  ];
}
