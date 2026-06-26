import type { Manga } from "@/lib/manga/types";
import { MangaCard } from "./MangaCard";

type MangaGridProps = {
  manga: Manga[];
};

export function MangaGrid({ manga }: MangaGridProps) {
  if (manga.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
        条件に一致する漫画がありません。
      </div>
    );
  }

  return (
    <div className="columns-2 gap-4 sm:columns-3 lg:columns-5 2xl:columns-6">
      {manga.map((item) => (
        <MangaCard key={item.id} manga={item} />
      ))}
    </div>
  );
}
