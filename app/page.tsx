import { MangaGrid } from "@/components/MangaGrid";
import { getPublicMangaSeriesGallery } from "@/lib/manga/service";

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
  const { manga } = await getPublicMangaSeriesGallery({
    query: params.q,
    tag: params.tag,
    author: params.author,
  });

  return (
    <main className="min-h-screen px-2 py-3 sm:px-4">
      <MangaGrid manga={manga} />
    </main>
  );
}
