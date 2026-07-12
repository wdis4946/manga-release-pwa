import Image from "next/image";
import Link from "next/link";
import type { Manga } from "@/lib/manga/types";

type MangaCardProps = {
  manga: Manga;
};

export function MangaCard({ manga }: MangaCardProps) {
  return (
    <article className="overflow-hidden rounded-md bg-stone-100 transition duration-200 hover:brightness-95">
      <Link
        href={`/manga/${manga.id}`}
        aria-label={`${manga.title}の詳細を見る`}
        className="relative block aspect-[21/32]"
      >
        <Image
          src={manga.coverImageUrl}
          alt={`${manga.title}の代表画像`}
          fill
          unoptimized
          className="object-cover"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1536px) 25vw, 16vw"
        />
      </Link>
    </article>
  );
}
