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
          <div className="relative aspect-[1.6/1] max-h-[calc(100dvh-32px)] w-[min(1040px,calc(100%_-_24px),calc((100dvh_-_32px)*1.6))] overflow-hidden rounded-[24px] border border-white/8 bg-gradient-to-b from-[#131827] to-[#0f1420] text-[#edf2ff] shadow-[0_30px_80px_rgba(0,0,0,0.62)]">
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
              <p className="flex min-h-[360px] items-center justify-center px-6 text-center text-sm text-white/60">
                {error}
              </p>
            ) : series ? (
              <SeriesModalBody
                series={series}
                coverImageUrl={series.representativeImageUrl ?? manga.coverImageUrl}
              />
            ) : null}
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
  const labels = [...series.publishers, ...series.genres];
  const primaryLabel = labels[0] ?? "MANGA";

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
            className="object-contain"
            sizes="(max-width: 768px) calc(100vw - 24px), 440px"
          />
        </div>

        <div className="overflow-y-auto bg-gradient-to-b from-white/[0.03] to-white/[0.01] p-6 [scrollbar-color:rgba(255,255,255,0.62)_transparent] [scrollbar-width:thin] md:p-9 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/60 [&::-webkit-scrollbar-track]:bg-transparent">
          <span className="inline-block rounded-full border border-white/6 bg-white/8 px-2.5 py-1 text-[11px] font-medium text-[#cad3f6]">
            {primaryLabel}
          </span>
          <h1 className="mt-3 pr-12 text-[28px] font-bold leading-[1.3] tracking-normal text-[#f5f7ff] sm:text-[34px]">
            {series.title}
          </h1>
          {series.authors.length > 0 ? (
            <p className="mt-3 text-sm font-medium text-[#a8b2d6]">
              {series.authors.join("、")}
            </p>
          ) : null}
          {series.publishers.length > 0 || series.genres.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-white/8 bg-white/6 px-3 py-1.5 text-xs font-medium text-[#eff3ff]"
                >
                  {label}
                </span>
              ))}
            </div>
          ) : null}

          {series.description ? (
            <p className="mt-6 whitespace-pre-line text-sm leading-[1.9] text-[#d0d7ee]">
              {series.description}
            </p>
          ) : (
            <p className="mt-6 text-sm leading-[1.9] text-[#d0d7ee]/70">
              あらすじはまだ登録されていません。
            </p>
          )}

          <div className="mt-7 border-t border-white/8 pt-6">
            <SeriesCategoryVolumes series={series} />
          </div>
        </div>
      </section>
    </div>
  );
}

function SeriesCategoryVolumes({ series }: { series: PublicSeriesDetail }) {
  if (series.categories.length === 0) {
    return (
      <p className="bg-transparent px-4 py-6 text-sm text-white/55">
        巻情報はまだ登録されていません。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {series.categories.map((category) => (
        <div key={category.categoryNumber} className="bg-transparent">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white/90">
              {category.categoryName}
            </h3>
            <span className="text-xs text-white/45">{category.itemCount}冊</span>
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
  );
}
