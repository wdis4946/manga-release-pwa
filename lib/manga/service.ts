import { fetchRakutenManga, fetchRakutenMangaByIsbn } from "@/lib/rakuten/client";
import { getFilteredManga, getMangaById } from "./filters";
import { mangaList } from "./mock-data";
import type { Manga, MangaFilters, MangaSort } from "./types";

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

export function normalizeSort(sort?: MangaSort): MangaSort {
  return sort === "latest" ? "latest" : "popular";
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
