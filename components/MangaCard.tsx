"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
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
  const [series, setSeries] = useState<PublicSeriesDetail>(() =>
    createInitialSeriesDetail(manga),
  );
  const [hasFetchedDetail, setHasFetchedDetail] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const loadSeriesDetail = useCallback(
    async (showLoading: boolean) => {
      if (hasFetchedDetail || isLoading) {
        return;
      }

      if (showLoading) {
        setIsLoading(true);
      }
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
        setHasFetchedDetail(true);
      } catch (loadError) {
        console.error("[Public manga] Failed to load series modal.", loadError);
        if (showLoading) {
          setError("詳細を取得できませんでした。");
        }
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [hasFetchedDetail, isLoading, manga.id],
  );

  function openModal() {
    window.dispatchEvent(new Event("public-gallery-modal-open"));
    setIsOpen(true);
    void loadSeriesDetail(false);
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
    if (hasFetchedDetail || isOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadSeriesDetail(false);
    }, 400 + Math.random() * 1200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hasFetchedDetail, isOpen, loadSeriesDetail]);

  return (
    <>
      <article className="min-w-0">
        <button
          type="button"
          aria-label={`${manga.title}の詳細を見る`}
          onClick={openModal}
          className="group/card relative block aspect-[21/32] w-full overflow-hidden rounded-2xl border border-white/5 bg-[#131827] shadow-[0_18px_38px_rgba(0,0,0,0.45)] transition duration-200 hover:-translate-y-1 hover:scale-[1.01] hover:shadow-[0_22px_48px_rgba(0,0,0,0.55)] hover:saturate-[1.08]"
        >
          <Image
            src={manga.coverImageUrl}
            alt={`${manga.title}の代表画像`}
            fill
            unoptimized
            className="object-cover transition duration-200 group-hover/card:scale-[1.015]"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1536px) 25vw, 16vw"
          />
          <span className="pointer-events-none absolute inset-x-[-20%] top-[-10%] h-[42%] bg-gradient-to-b from-white/15 to-transparent" />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[36%] bg-gradient-to-b from-transparent to-black/25" />
        </button>
      </article>

      {isOpen ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-[rgba(5,7,12,0.62)] backdrop-blur-[8px]"
          role="dialog"
          aria-modal="true"
          aria-label={`${manga.title}の詳細`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false);
            }
          }}
        >
          <div className="relative aspect-[1.5/1] max-h-[calc(100dvh-24px)] w-[min(1120px,calc(100%_-_24px),calc((100dvh_-_24px)*1.5))] overflow-hidden rounded-[24px] border border-white/8 bg-gradient-to-b from-[#131827] to-[#0f1420] text-[#edf2ff] shadow-[0_30px_80px_rgba(0,0,0,0.62)]">
            <button
              type="button"
              title="閉じる"
              onClick={() => setIsOpen(false)}
              className="absolute right-3 top-3 z-10 flex size-[42px] items-center justify-center rounded-full border border-white/8 bg-[rgba(12,16,25,0.84)] text-[#eaf0ff] shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition hover:bg-white/10"
            >
              <X className="size-5" />
            </button>

            {isLoading ? (
              <div className="flex min-h-[360px] items-center justify-center">
                <LoaderCircle className="size-7 animate-spin text-white/70" />
              </div>
            ) : error ? (
              <p className="flex min-h-[360px] items-center justify-center px-6 text-center text-base text-white/60">
                {error}
              </p>
            ) : (
              <SeriesModalBody
                series={series}
                coverImageUrl={series.representativeImageUrl ?? manga.coverImageUrl}
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function SeriesModalBody({
  series,
  coverImageUrl,
}: {
  series: PublicSeriesDetail;
  coverImageUrl: string;
}) {
  const labels = series.genres;
  const firstVolume = series.firstVolume;

  return (
    <div className="h-full overflow-hidden">
      <section className="grid h-full md:grid-cols-[minmax(290px,0.85fr)_1.15fr]">
        <div className="relative h-[48dvh] max-h-[420px] min-h-[260px] bg-[#0d111b] md:h-auto md:max-h-none md:min-h-0">
          <Image
            src={coverImageUrl}
            alt={`${series.title}の代表画像`}
            fill
            unoptimized
            priority
            className="object-cover"
            sizes="(max-width: 768px) calc(100vw - 24px), 440px"
          />
        </div>

        <div className="flex h-full flex-col overflow-hidden bg-gradient-to-b from-white/[0.03] to-white/[0.01] p-6 md:p-9">
          <h1 className="pr-12 text-[28px] font-bold leading-[1.3] tracking-normal text-[#f5f7ff] sm:text-[34px]">
            {series.title}
          </h1>
          {series.authors.length > 0 ? (
            <p className="mt-3 text-base font-medium text-[#a8b2d6]">
              {series.authors.join("、")}
            </p>
          ) : null}
          {labels.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-white/8 bg-white/6 px-3 py-1.5 text-base font-medium text-[#cad3f6]"
                >
                  {label}
                </span>
              ))}
            </div>
          ) : null}

          {series.description ? (
            <p className="mt-6 min-h-0 flex-1 overflow-y-auto pr-4 whitespace-pre-line text-xl leading-[1.9] text-[#d0d7ee] [scrollbar-color:rgba(255,255,255,0.5)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/50 [&::-webkit-scrollbar-track]:bg-transparent">
              {series.description}
            </p>
          ) : (
            <p className="mt-6 min-h-0 flex-1 text-base leading-[1.9] text-[#d0d7ee]/70">
              あらすじはまだ登録されていません。
            </p>
          )}

          {firstVolume ? (
            <div className="flex justify-end gap-3 pt-5">
              <a
                href={getAmazonSearchUrl(firstVolume.isbn)}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-white/10 bg-white/[0.08] px-5 py-3 text-base font-semibold text-white/85 transition hover:bg-white/[0.14] hover:text-white"
              >
                Amazon
              </a>
              <a
                href={firstVolume.itemUrl ?? getRakutenSearchUrl(firstVolume.isbn)}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-white/10 bg-white/[0.08] px-5 py-3 text-base font-semibold text-white/85 transition hover:bg-white/[0.14] hover:text-white"
              >
                楽天市場
              </a>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function createInitialSeriesDetail(manga: Manga): PublicSeriesDetail {
  return {
    id: manga.id,
    title: manga.title,
    searchTitle: manga.title,
    description: manga.description,
    representativeImageUrl: manga.coverImageUrl,
    authors: manga.authorName ? [manga.authorName] : [],
    genres: manga.genres,
    publishers: [],
    categories: [],
    firstVolume: manga.isbn
      ? {
          isbn: manga.isbn,
          label: "1巻",
          displayOrder: 0,
          title: manga.title,
          coverImageUrl: null,
          itemUrl: manga.rakutenUrl ?? null,
          salesDate: null,
        }
      : null,
  };
}

function getAmazonSearchUrl(isbn: string) {
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(isbn)}`;
}

function getRakutenSearchUrl(isbn: string) {
  return `https://books.rakuten.co.jp/search?sitem=${encodeURIComponent(isbn)}`;
}
