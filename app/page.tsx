import { InfiniteMangaGrid } from "@/components/InfiniteMangaGrid";
import { GroupedMangaGallery } from "@/components/GroupedMangaGallery";
import {
  PUBLIC_GALLERY_PAGE_SIZE,
  getPublicMangaDisplayGroups,
  getPublicMangaSeriesGallery,
} from "@/lib/manga/service";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<{
    q?: string;
    tag?: string;
    author?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const hasFilters = Boolean(params.q || params.tag || params.author);
  const displayGroups = hasFilters ? [] : await getPublicMangaDisplayGroups();

  if (displayGroups.length > 0) {
    return (
      <main className="font-yomogi min-h-screen px-2 py-3 sm:px-4">
        <GroupedMangaGallery groups={displayGroups} />
      </main>
    );
  }

  const { manga } = await getPublicMangaSeriesGallery({
    query: params.q,
    tag: params.tag,
    author: params.author,
    limit: PUBLIC_GALLERY_PAGE_SIZE,
  });

  return (
    <main className="font-yomogi min-h-screen px-2 py-3 sm:px-4">
      <InfiniteMangaGrid
        key={`${params.q ?? ""}:${params.tag ?? ""}:${params.author ?? ""}`}
        initialManga={manga}
        filters={{
          query: params.q,
          tag: params.tag,
          author: params.author,
        }}
        pageSize={PUBLIC_GALLERY_PAGE_SIZE}
      />
    </main>
  );
}
