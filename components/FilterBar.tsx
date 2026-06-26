import Link from "next/link";
import type { MangaSort } from "@/lib/manga/types";

type FilterBarProps = {
  activeSort: MangaSort;
  activeGenre?: string;
  activeAuthor?: string;
  genres: string[];
  authors: string[];
};

export function FilterBar({
  activeSort,
  activeGenre,
  activeAuthor,
  genres,
  authors,
}: FilterBarProps) {
  return (
    <div className="grid gap-3 rounded-md bg-white p-3 ring-1 ring-stone-200 md:grid-cols-2">
      <FilterGroup
        label="ジャンル"
        paramName="genre"
        values={genres}
        activeValue={activeGenre}
        activeSort={activeSort}
        pairedParam={{ name: "author", value: activeAuthor }}
      />
      <FilterGroup
        label="作者"
        paramName="author"
        values={authors}
        activeValue={activeAuthor}
        activeSort={activeSort}
        pairedParam={{ name: "genre", value: activeGenre }}
      />
    </div>
  );
}

type FilterGroupProps = {
  label: string;
  paramName: "genre" | "author";
  values: string[];
  activeValue?: string;
  activeSort: MangaSort;
  pairedParam: {
    name: "genre" | "author";
    value?: string;
  };
};

function FilterGroup({
  label,
  paramName,
  values,
  activeValue,
  activeSort,
  pairedParam,
}: FilterGroupProps) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-normal text-stone-500">
          {label}
        </h2>
        {activeValue ? (
          <Link
            href={buildFilterHref(activeSort, paramName, undefined, pairedParam)}
            className="text-xs font-medium text-stone-500 hover:text-stone-950"
          >
            解除
          </Link>
        ) : null}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {values.map((value) => {
          const isActive = value === activeValue;

          return (
            <Link
              key={value}
              href={buildFilterHref(activeSort, paramName, value, pairedParam)}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                isActive
                  ? "bg-cyan-700 text-white"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200"
              }`}
            >
              {value}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function buildFilterHref(
  sort: MangaSort,
  paramName: "genre" | "author",
  value: string | undefined,
  pairedParam: { name: "genre" | "author"; value?: string },
): string {
  const params = new URLSearchParams();
  params.set("sort", sort);
  if (value) params.set(paramName, value);
  if (pairedParam.value) params.set(pairedParam.name, pairedParam.value);

  return `/?${params.toString()}`;
}
