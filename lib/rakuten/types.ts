export type RakutenBook = {
  title?: string;
  titleKana?: string;
  subTitle?: string;
  author?: string;
  publisherName?: string;
  itemCaption?: string;
  isbn?: string;
  salesDate?: string;
  booksGenreId?: string;
  itemUrl?: string;
  affiliateUrl?: string;
  smallImageUrl?: string;
  mediumImageUrl?: string;
  largeImageUrl?: string;
};

export type RakutenBooksResponse = {
  Items?: RakutenBook[];
  count?: number;
  page?: number;
  first?: number;
  last?: number;
  hits?: number;
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
