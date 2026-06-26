import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PurchaseButtons } from "@/components/PurchaseButtons";
import { getMangaById } from "@/lib/manga/filters";
import { formatReleaseDate, isSoonRelease } from "@/lib/utils/date";

type MangaDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function MangaDetailPage({ params }: MangaDetailPageProps) {
  const { id } = await params;
  const manga = getMangaById(id);

  if (!manga) {
    notFound();
  }

  const volumeNumbers = Array.from(
    { length: manga.latestVolumeNumber },
    (_, index) => manga.latestVolumeNumber - index,
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
      <Link
        href="/"
        className="mb-4 inline-flex rounded-md px-2 py-2 text-sm font-semibold text-stone-600 hover:bg-stone-200 hover:text-stone-950"
      >
        一覧へ戻る
      </Link>

      <section className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-stone-200">
            <Image
              src={manga.coverImageUrl}
              alt={`${manga.title}の表紙`}
              width={420}
              height={640}
              priority
              className="h-auto w-full object-cover"
            />
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-md bg-white p-5 ring-1 ring-stone-200">
            {isSoonRelease(manga.nextReleaseDate) ? (
              <span className="mb-3 inline-flex rounded bg-amber-300 px-2 py-1 text-xs font-bold text-stone-950">
                発売間近
              </span>
            ) : null}
            <h1 className="text-3xl font-bold tracking-normal text-stone-950">
              {manga.title}
            </h1>
            <p className="mt-2 text-sm font-medium text-stone-500">
              {manga.authorName}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {manga.genres.map((genre) => (
                <span
                  key={genre}
                  className="rounded bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700"
                >
                  {genre}
                </span>
              ))}
            </div>
            <p className="mt-5 text-sm leading-7 text-stone-700">
              {manga.description}
            </p>
          </div>

          <div className="rounded-md bg-white p-5 ring-1 ring-stone-200">
            <h2 className="text-base font-bold text-stone-950">新刊情報</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-md bg-stone-100 p-3">
                <dt className="text-xs font-semibold text-stone-500">最新巻</dt>
                <dd className="mt-1 font-bold text-stone-950">
                  {manga.latestVolumeNumber}巻
                </dd>
              </div>
              <div className="rounded-md bg-stone-100 p-3">
                <dt className="text-xs font-semibold text-stone-500">
                  次巻発売日
                </dt>
                <dd className="mt-1 font-bold text-stone-950">
                  {formatReleaseDate(manga.nextReleaseDate)}
                </dd>
              </div>
            </dl>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button className="min-h-11 rounded-md bg-cyan-700 px-4 text-sm font-bold text-white transition hover:bg-cyan-800">
                お気に入り登録
              </button>
              <button className="min-h-11 rounded-md bg-stone-950 px-4 text-sm font-bold text-white transition hover:bg-stone-800">
                新刊通知 ON
              </button>
            </div>
          </div>

          <div className="rounded-md bg-white p-5 ring-1 ring-stone-200">
            <h2 className="mb-3 text-base font-bold text-stone-950">
              購入・レンタル
            </h2>
            <PurchaseButtons manga={manga} />
          </div>

          <div className="rounded-md bg-white p-5 ring-1 ring-stone-200">
            <h2 className="text-base font-bold text-stone-950">巻一覧</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {volumeNumbers.map((volumeNumber) => (
                <div
                  key={volumeNumber}
                  className="rounded-md bg-stone-100 px-3 py-3 text-sm font-semibold text-stone-700"
                >
                  {volumeNumber}巻
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
