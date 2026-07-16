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
            <h2 className="text-sm font-normal leading-6 text-[#a8b2d6]">
              {group.name}
            </h2>
          </div>
          <MangaGrid manga={group.manga} />
        </section>
      ))}
    </div>
  );
}
