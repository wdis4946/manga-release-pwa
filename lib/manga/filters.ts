import { mangaList } from "./mock-data";
import type { Manga, MangaFilters, MangaSort } from "./types";

export const sortLabels: Record<MangaSort, string> = {
  popular: "人気順",
  latest: "最新順",
};

export const sortOptions = Object.keys(sortLabels) as MangaSort[];

export const getAllGenres = (): string[] => {
  return Array.from(new Set(mangaList.flatMap((manga) => manga.genres))).sort(
    (a, b) => a.localeCompare(b, "ja"),
  );
};

export const getAllAuthors = (): string[] => {
  return Array.from(new Set(mangaList.map((manga) => manga.authorName))).sort(
    (a, b) => a.localeCompare(b, "ja"),
  );
};

export const getMangaById = (id: string): Manga | undefined => {
  return mangaList.find((manga) => manga.id === id || manga.isbn === id);
};

export const getFilteredManga = (filters: MangaFilters): Manga[] => {
  const sort = filters.sort === "latest" ? "latest" : "popular";

  const filtered = mangaList.filter((manga) => {
    const matchesGenre = filters.genre
      ? manga.genres.includes(filters.genre)
      : true;
    const matchesAuthor = filters.author
      ? manga.authorName === filters.author
      : true;

    return matchesGenre && matchesAuthor;
  });

  return [...filtered].sort((a, b) => compareManga(a, b, sort));
};

const compareManga = (a: Manga, b: Manga, sort: MangaSort): number => {
  if (sort === "latest") {
    return dateValue(b.nextReleaseDate) - dateValue(a.nextReleaseDate);
  }

  return b.popularityScore - a.popularityScore;
};

const dateValue = (date?: string): number => {
  return date ? new Date(date).getTime() : 0;
};
