"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import type { Manga } from "@/lib/manga/types";
import type { PublicSeriesDetail } from "@/lib/manga/service";

type MangaCardProps = {
  manga: Manga;
};

type PublicSeriesDetailResponse = {
  series: PublicSeriesDetail;
};

export function MangaCard({ manga }: MangaCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [series, setSeries] = useState<PublicSeriesDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  function openModal() {
    window.dispatchEvent(new Event("public-gallery-modal-open"));
    setIsOpen(true);
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || series || isLoading) {
      return;
    }

    async function loadSeriesDetail() {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(`/api/public/series/${manga.id}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to load series: ${response.status}`);
        }

        const payload = (await response.json()) as PublicSeriesDetailResponse;
        setSeries(payload.series);
      } catch (loadError) {
        console.error("[Public manga] Failed to load series modal.", loadError);
        setError("詳細を取得できませんでした。");
      } finally {
        setIsLoading(false);
      }
    }

    void loadSeriesDetail();
  }, [isLoading, isOpen, manga.id, series]);

  return (
    <>
      <article className="overflow-hidden rounded-xl bg-stone-100 transition duration-200 hover:brightness-95">
        <button
          type="button"
          aria-label={`${manga.title}の詳細を見る`}
          onClick={openModal}
          className="relative block aspect-[21/32] w-full"
        >
          <Image
            src={manga.coverImageUrl}
            alt={`${manga.title}の代表画像`}
            fill
            unoptimized
            className="object-cover"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1536px) 25vw, 16vw"
          />
        </button>
      </article>

      {isOpen ? (
        <div
          className="fixed inset-x-0 bottom-0 top-[72px] z-10 bg-stone-950/90 px-2 pb-3 backdrop-blur-[2px] sm:px-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${manga.title}の詳細`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false);
            }
          }}
        >
          <div className="relative grid h-full overflow-hidden rounded-2xl bg-transparent md:grid-cols-[minmax(260px,40%)_1fr] 2xl:mx-[5.555556vw]">
            <button
              type="button"
              title="閉じる"
              onClick={() => setIsOpen(false)}
              className="fixed right-2 top-[84px] z-10 flex size-10 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/20 hover:bg-black/70 sm:right-4"
            >
              <X className="size-5" />
            </button>

            <div className="relative h-[38%] bg-transparent md:h-full">
              <Image
                src={series?.representativeImageUrl ?? manga.coverImageUrl}
                alt={`${series?.title ?? manga.title}の代表画像`}
                fill
                unoptimized
                priority
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 40vw"
              />
            </div>

            <div className="h-[62%] overflow-y-auto bg-transparent py-6 pl-5 pr-1 [scrollbar-color:rgba(255,255,255,0.72)_transparent] [scrollbar-width:thin] sm:pl-7 sm:pr-1 md:h-full md:py-8 md:pl-9 md:pr-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/70 [&::-webkit-scrollbar-track]:bg-transparent">
              {isLoading ? (
                <div className="flex min-h-80 items-center justify-center">
                  <LoaderCircle className="size-7 animate-spin text-stone-500" />
                </div>
              ) : error ? (
                <p className="py-16 text-center text-sm text-stone-500">
                  {error}
                </p>
              ) : series ? (
                <SeriesModalBody series={series} />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SeriesModalBody({ series }: { series: PublicSeriesDetail }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="pr-12 text-2xl font-bold leading-9 tracking-normal text-white sm:text-3xl">
          {series.title}
        </h1>
        {series.authors.length > 0 ? (
          <p className="mt-2 text-sm font-medium text-white/75">
            {series.authors.join("、")}
          </p>
        ) : null}
        {series.publishers.length > 0 || series.genres.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {[...series.publishers, ...series.genres].map((label) => (
              <span
                key={label}
                className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/75 ring-1 ring-white/15"
              >
                {label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {series.description ? (
        <p className="whitespace-pre-line text-base leading-8 text-white/85">
          {series.description}
        </p>
      ) : (
        <p className="text-base leading-8 text-white/55">
          あらすじはまだ登録されていません。
        </p>
      )}

      <section>
        {series.categories.length > 0 ? (
          <div className="space-y-4">
            {series.categories.map((category) => (
              <div
                key={category.categoryNumber}
                className="bg-transparent"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white/90">
                    {category.categoryName}
                  </h3>
                  <span className="text-xs text-white/45">
                    {category.itemCount}冊
                  </span>
                </div>
                {category.volumes.length > 0 ? (
                  <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
                    {category.volumes.map((volume) => (
                      <a
                        key={`${category.categoryNumber}:${volume.displayOrder}:${volume.isbn}`}
                        href={volume.itemUrl ?? undefined}
                        target={volume.itemUrl ? "_blank" : undefined}
                        rel={volume.itemUrl ? "noreferrer" : undefined}
                        className="group grid min-w-0 gap-2"
                      >
                        <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-white/10">
                          {volume.coverImageUrl ? (
                            <Image
                              src={volume.coverImageUrl}
                              alt={volume.title}
                              fill
                              unoptimized
                              className="object-contain transition group-hover:scale-[1.03]"
                              sizes="(max-width: 640px) 30vw, (max-width: 1024px) 18vw, 120px"
                            />
                          ) : (
                            <div className="flex size-full items-center justify-center px-2 text-center text-[11px] text-white/45">
                              no image
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-white/80">
                            {volume.label}
                          </p>
                          <p className="line-clamp-2 text-[11px] leading-4 text-white/55">
                            {volume.title}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-white/45">
                    表示できる巻情報がありません。
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="bg-transparent px-4 py-6 text-sm text-white/55">
            巻情報はまだ登録されていません。
          </p>
        )}
      </section>
    </div>
  );
}
