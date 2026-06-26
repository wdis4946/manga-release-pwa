import Image from "next/image";
import Link from "next/link";
import type { Manga } from "@/lib/manga/types";
import { formatReleaseDate, isSoonRelease } from "@/lib/utils/date";

type MangaCardProps = {
  manga: Manga;
};

export function MangaCard({ manga }: MangaCardProps) {
  const isSoon = isSoonRelease(manga.nextReleaseDate);

  return (
    <article className="mb-4 break-inside-avoid overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-stone-200 transition hover:-translate-y-0.5 hover:shadow-md">
      <Link href={`/manga/${manga.id}`} className="block">
        <div className="relative bg-stone-200">
          <Image
            src={manga.coverImageUrl}
            alt={`${manga.title}の表紙`}
            width={420}
            height={640}
            className="h-auto w-full object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 18vw"
          />
          {isSoon ? (
            <span className="absolute left-2 top-2 rounded bg-amber-300 px-2 py-1 text-xs font-bold text-stone-950">
              発売間近
            </span>
          ) : null}
        </div>
        <div className="space-y-2 p-3">
          <div>
            <h2 className="line-clamp-2 text-sm font-bold leading-5 text-stone-950">
              {manga.title}
            </h2>
            <p className="mt-1 text-xs text-stone-500">{manga.authorName}</p>
          </div>
          <div className="text-xs leading-5 text-stone-600">
            <p>最新 {manga.latestVolumeNumber}巻</p>
            <p>{formatReleaseDate(manga.nextReleaseDate)}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {manga.genres.slice(0, 3).map((genre) => (
              <span
                key={genre}
                className="rounded bg-stone-100 px-1.5 py-1 text-[11px] font-medium text-stone-600"
              >
                {genre}
              </span>
            ))}
          </div>
        </div>
      </Link>
    </article>
  );
}
