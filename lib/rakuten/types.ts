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
  size?: string | number;
  itemCaption?: string;
  isbn?: string;
  salesDate?: string;
  itemPrice?: number | string;
  listPrice?: number | string;
  discountRate?: number | string;
  discountPrice?: number | string;
  booksGenreId?: string;
  itemUrl?: string;
  affiliateUrl?: string;
  smallImageUrl?: string;
  mediumImageUrl?: string;
  largeImageUrl?: string;
  chirayomiUrl?: string;
  availability?: number | string;
  postageFlag?: number | string;
  limitedFlag?: number | string;
  reviewCount?: number | string;
  reviewAverage?: number | string;
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
  itemCount?: number | string;
};

export type RakutenBooksGenreResponse = {
  current?: RakutenBooksGenre;
  parents?: RakutenBooksGenre[];
  children?: RakutenBooksGenre[];
};
