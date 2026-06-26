export type Manga = {
  id: string;
  isbn?: string;
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
  source?: "mock" | "rakuten";
};

export type MangaSort = "popular" | "latest";

export type MangaFilters = {
  sort?: MangaSort;
  genre?: string;
  author?: string;
};
