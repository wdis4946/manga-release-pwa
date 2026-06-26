import { mangaList } from "./mock-data";
import type { Manga, MangaFilters, MangaSort } from "./types";

export const sortLabels: Record<MangaSort, string> = {
  popular: "人気順",
  latest: "最新順",
  release_date: "発売日が近い順",
  title: "タイトル順",
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
  return mangaList.find((manga) => manga.id === id);
};

export const getFilteredManga = (filters: MangaFilters): Manga[] => {
  const sort = isMangaSort(filters.sort) ? filters.sort : "popular";

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

const isMangaSort = (value: unknown): value is MangaSort => {
  return typeof value === "string" && sortOptions.includes(value as MangaSort);
};

const compareManga = (a: Manga, b: Manga, sort: MangaSort): number => {
  if (sort === "popular") {
    return b.popularityScore - a.popularityScore;
  }

  if (sort === "latest") {
    return b.latestVolumeNumber - a.latestVolumeNumber;
  }

  if (sort === "release_date") {
    // Missing release dates are pushed to the end, matching future API behavior.
    return dateValue(a.nextReleaseDate) - dateValue(b.nextReleaseDate);
  }

  return a.title.localeCompare(b.title, "ja");
};

const dateValue = (date?: string): number => {
  return date ? new Date(date).getTime() : Number.MAX_SAFE_INTEGER;
};
