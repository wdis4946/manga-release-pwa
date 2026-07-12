import Image from "next/image";
import Link from "next/link";
import type { Manga } from "@/lib/manga/types";

type MangaCardProps = {
  manga: Manga;
};

export function MangaCard({ manga }: MangaCardProps) {
  return (
    <article className="mb-3 break-inside-avoid overflow-hidden rounded-md bg-stone-100 transition duration-200 hover:brightness-95 sm:mb-4">
      <Link href={`/manga/${manga.id}`} aria-label={`${manga.title}の詳細を見る`}>
        <Image
          src={manga.coverImageUrl}
          alt={`${manga.title}の代表画像`}
          width={420}
          height={640}
          unoptimized
          className="h-auto w-full object-cover"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 18vw"
        />
      </Link>
    </article>
  );
}
