import Link from "next/link";
import { sortLabels, sortOptions } from "@/lib/manga/filters";
import type { MangaSort } from "@/lib/manga/types";

type SortTabsProps = {
  activeSort: MangaSort;
  genre?: string;
  author?: string;
};

export function SortTabs({ activeSort, genre, author }: SortTabsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {sortOptions.map((sort) => {
        const params = new URLSearchParams();
        params.set("sort", sort);
        if (genre) params.set("genre", genre);
        if (author) params.set("author", author);

        const isActive = sort === activeSort;

        return (
          <Link
            key={sort}
            href={`/?${params.toString()}`}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-semibold transition ${
              isActive
                ? "bg-stone-950 text-white"
                : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-100"
            }`}
          >
            {sortLabels[sort]}
          </Link>
        );
      })}
    </div>
  );
}
