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
};

export type ManagedMangaSeries = MangaSeriesCandidate & {
  itemCount: number;
};

export type ManagedSeriesItem = {
  isbn: string;
  title: string;
  author: string | null;
  publisherName: string | null;
  salesDate: string | null;
  coverImageUrl: string | null;
  itemUrl: string | null;
  matchMethod: string;
  matchedAt: string;
};
