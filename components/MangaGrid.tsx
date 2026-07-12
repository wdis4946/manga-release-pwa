import type { Manga } from "@/lib/manga/types";
import { MangaCard } from "./MangaCard";

type MangaGridProps = {
  manga: Manga[];
};

export function MangaGrid({ manga }: MangaGridProps) {
  if (manga.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-sm font-medium text-stone-500">
        表示できる漫画がありません。
      </div>
    );
  }

  return (
    <div className="columns-2 gap-3 sm:columns-3 sm:gap-4 lg:columns-5 2xl:columns-7">
      {manga.map((item) => (
        <MangaCard key={item.id} manga={item} />
      ))}
    </div>
  );
}
