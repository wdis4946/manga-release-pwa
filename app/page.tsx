import { FilterBar } from "@/components/FilterBar";
import { MangaGrid } from "@/components/MangaGrid";
import { SortTabs } from "@/components/SortTabs";
import {
  getAllAuthors,
  getAllGenres,
  getFilteredManga,
} from "@/lib/manga/filters";
import type { MangaSort } from "@/lib/manga/types";

type HomeProps = {
  searchParams: Promise<{
    sort?: MangaSort;
    genre?: string;
    author?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const activeSort = params.sort ?? "popular";
  const manga = getFilteredManga(params);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6">
      <section className="mb-5">
        <p className="text-sm font-semibold text-cyan-700">Phase 1 Mock</p>
        <h1 className="mt-1 text-2xl font-bold tracking-normal text-stone-950 sm:text-3xl">
          新刊を追いかけたい漫画を探す
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
          表紙から探して、発売日が近い作品や作者別の作品をすばやく確認できます。
        </p>
      </section>

      <div className="mb-5 space-y-3">
        <SortTabs
          activeSort={activeSort}
          genre={params.genre}
          author={params.author}
        />
        <FilterBar
          activeSort={activeSort}
          activeGenre={params.genre}
          activeAuthor={params.author}
          genres={getAllGenres()}
          authors={getAllAuthors()}
        />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-700">
          {manga.length} 件の漫画
        </p>
        <p className="text-xs text-stone-500">スマホ2列 / PC5から6列</p>
      </div>

      <MangaGrid manga={manga} />
    </main>
  );
}
