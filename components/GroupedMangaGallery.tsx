import type { PublicMangaDisplayGroup } from "@/lib/manga/service";
import { MangaGrid } from "./MangaGrid";

type GroupedMangaGalleryProps = {
  groups: PublicMangaDisplayGroup[];
};

export function GroupedMangaGallery({ groups }: GroupedMangaGalleryProps) {
  return (
    <div className="space-y-10">
      {groups.map((group) => (
        <section key={group.id} className="space-y-3">
          <div className="px-1 2xl:mx-[5.555556vw]">
            <h2 className="text-base font-bold text-stone-950 sm:text-lg">
              {group.name}
            </h2>
            {group.description ? (
              <p className="mt-1 text-sm leading-6 text-stone-600">
                {group.description}
              </p>
            ) : null}
          </div>
          <MangaGrid manga={group.manga} />
        </section>
      ))}
    </div>
  );
}
