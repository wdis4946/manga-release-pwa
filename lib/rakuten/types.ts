export type RakutenBook = {
  [key: string]: unknown;
  title?: string;
  titleKana?: string;
  subTitle?: string;
  subTitleKana?: string;
  seriesName?: string;
  seriesNameKana?: string;
  contents?: string;
  contentsKana?: string;
  author?: string;
  authorKana?: string;
  publisherName?: string;
  size?: number;
  itemCaption?: string;
  isbn?: string;
  salesDate?: string;
  itemPrice?: number;
  listPrice?: number;
  discountRate?: number;
  discountPrice?: number;
  booksGenreId?: string;
  itemUrl?: string;
  affiliateUrl?: string;
  smallImageUrl?: string;
  mediumImageUrl?: string;
  largeImageUrl?: string;
  chirayomiUrl?: string;
  availability?: number;
  postageFlag?: number;
  limitedFlag?: number;
  reviewCount?: number;
  reviewAverage?: number;
};

export type RakutenBooksResponse = {
  Items?: RakutenBook[];
  count?: number;
  page?: number;
  first?: number;
  last?: number;
  hits?: number;
  pageCount?: number;
};

export type RakutenBooksGenre = {
  booksGenreId?: string;
  booksGenreName?: string;
  genreLevel?: number;
};

export type RakutenBooksGenreResponse = {
  current?: RakutenBooksGenre;
  parents?: RakutenBooksGenre[];
  children?: RakutenBooksGenre[];
};
