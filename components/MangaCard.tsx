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
          onClick={() => setIsOpen(true)}
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
          className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/65 px-3 py-5 backdrop-blur-[2px] sm:px-5"
          role="dialog"
          aria-modal="true"
          aria-label={`${manga.title}の詳細`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false);
            }
          }}
        >
          <div className="mx-auto grid min-h-[calc(100vh-40px)] w-full max-w-6xl items-center">
            <div className="relative grid max-h-[calc(100vh-40px)] overflow-hidden rounded-2xl bg-stone-50 shadow-2xl md:grid-cols-[minmax(240px,38%)_1fr]">
              <button
                type="button"
                title="閉じる"
                onClick={() => setIsOpen(false)}
                className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow-sm hover:bg-white"
              >
                <X className="size-5" />
              </button>

              <div className="relative min-h-[320px] bg-stone-200 md:min-h-[calc(100vh-40px)]">
                <Image
                  src={series?.representativeImageUrl ?? manga.coverImageUrl}
                  alt={`${series?.title ?? manga.title}の代表画像`}
                  fill
                  unoptimized
                  priority
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 38vw"
                />
              </div>

              <div className="max-h-[calc(100vh-40px)] overflow-y-auto px-5 py-6 sm:px-7">
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
        </div>
      ) : null}
    </>
  );
}

function SeriesModalBody({ series }: { series: PublicSeriesDetail }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="pr-10 text-2xl font-bold leading-9 tracking-normal text-stone-950 sm:text-3xl">
          {series.title}
        </h1>
        {series.authors.length > 0 ? (
          <p className="mt-2 text-sm font-medium text-stone-600">
            {series.authors.join("、")}
          </p>
        ) : null}
        {series.publishers.length > 0 || series.genres.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {[...series.publishers, ...series.genres].map((label) => (
              <span
                key={label}
                className="rounded-full bg-stone-200 px-2.5 py-1 text-xs font-medium text-stone-600"
              >
                {label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {series.description ? (
        <p className="whitespace-pre-line text-sm leading-8 text-stone-700">
          {series.description}
        </p>
      ) : (
        <p className="text-sm leading-8 text-stone-500">
          あらすじはまだ登録されていません。
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-stone-700">巻一覧</h2>
        {series.categories.length > 0 ? (
          <div className="space-y-4">
            {series.categories.map((category) => (
              <div
                key={category.categoryNumber}
                className="rounded-xl border border-stone-200 bg-white p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-stone-800">
                    {category.categoryName}
                  </h3>
                  <span className="text-xs text-stone-400">
                    {category.itemCount}冊
                  </span>
                </div>
                {category.volumes.length > 0 ? (
                  <div className="mt-3 flex gap-3">
                    {category.volumes.map((volume) => (
                      <a
                        key={`${category.categoryNumber}:${volume.role}:${volume.isbn}`}
                        href={volume.itemUrl ?? undefined}
                        target={volume.itemUrl ? "_blank" : undefined}
                        rel={volume.itemUrl ? "noreferrer" : undefined}
                        className="group grid w-24 gap-2"
                      >
                        <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-stone-100">
                          {volume.coverImageUrl ? (
                            <Image
                              src={volume.coverImageUrl}
                              alt={volume.title}
                              fill
                              unoptimized
                              className="object-cover transition group-hover:scale-[1.03]"
                              sizes="96px"
                            />
                          ) : (
                            <div className="flex size-full items-center justify-center px-2 text-center text-[11px] text-stone-400">
                              no image
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-stone-700">
                            {volume.label}
                          </p>
                          <p className="line-clamp-2 text-[11px] leading-4 text-stone-500">
                            {volume.title}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-stone-400">
                    表示できる巻情報がありません。
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-stone-200 bg-white px-4 py-6 text-sm text-stone-500">
            巻情報はまだ登録されていません。
          </p>
        )}
      </section>
    </div>
  );
}
