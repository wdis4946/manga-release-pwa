export type MatchingIssue = {
  isbn: string;
  normalizedTitle: string;
  issueType: "unmatched" | "ambiguous";
  candidateCount: number;
  candidateSeriesIds: string[];
  isResolved: boolean;
  detectedAt: string;
  title: string;
  author: string | null;
  publisherName: string | null;
  salesDate: string | null;
  coverImageUrl: string | null;
  itemUrl: string | null;
};

export type MangaSeriesCandidate = {
  id: string;
  searchTitle: string;
  displayTitle: string;
  similarityScore?: number;
};

export type ManagedMangaSeries = MangaSeriesCandidate & {
  itemCount: number;
};

export type ManagedSeriesCategory = {
  categoryNumber: number;
  categoryName: string;
  itemCount: number;
};

export type ManagedSeriesAgent = {
  agentId: string;
  agentName: string;
  authorWikiLink: string | null;
  sortOrder: number;
};

export type ManagedSeriesGenre = {
  genreId: string;
  genreName: string | null;
};

export type ManagedGenre = {
  genreId: string;
  genreName: string;
};

export type ManagedAgent = {
  id: string;
  name: string;
  birthDate: string | null;
  activeStartYear: number | null;
  activeEndYear: number | null;
  birthPlace: string | null;
  authorWikiLink: string | null;
  gender: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ManagedSeriesItem = {
  isbn: string;
  categoryNumber: number;
  categoryName: string;
  displayOrder: number;
  title: string;
  normalizedTitle: string | null;
  author: string | null;
  publisherName: string | null;
  salesDate: string | null;
  coverImageUrl: string | null;
  itemUrl: string | null;
  matchMethod: string;
  matchedAt: string;
};
