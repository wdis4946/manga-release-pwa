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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 2xl:mx-[5.555556vw] 2xl:grid-cols-6">
      {manga.map((item) => (
        <MangaCard key={item.id} manga={item} />
      ))}
    </div>
  );
}
