export type Manga = {
  id: string;
  title: string;
  authorName: string;
  description: string;
  coverImageUrl: string;
  genres: string[];
  popularityScore: number;
  latestVolumeNumber: number;
  nextReleaseDate?: string;
  amazonUrl?: string;
  rakutenUrl?: string;
  rentalUrl?: string;
};

export type MangaSort = "popular" | "latest" | "release_date" | "title";

export type MangaFilters = {
  sort?: MangaSort;
  genre?: string;
  author?: string;
};
