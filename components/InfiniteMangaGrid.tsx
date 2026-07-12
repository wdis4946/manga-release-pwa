"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Manga } from "@/lib/manga/types";
import { MangaGrid } from "./MangaGrid";

type InfiniteMangaGridProps = {
  initialManga: Manga[];
  filters: {
    query?: string;
    tag?: string;
    author?: string;
  };
  pageSize: number;
};

export function InfiniteMangaGrid({
  initialManga,
  filters,
  pageSize,
}: InfiniteMangaGridProps) {
  const [manga, setManga] = useState(initialManga);
  const [isLoading, setIsLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const mangaRef = useRef(initialManga);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(initialManga.length >= pageSize);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) {
      return;
    }

    loadingRef.current = true;
    setIsLoading(true);

    try {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));

      if (filters.query) params.set("q", filters.query);
      if (filters.tag) params.set("tag", filters.tag);
      if (filters.author) params.set("author", filters.author);

      const excludeIds = mangaRef.current.map((item) => item.id);
      if (excludeIds.length > 0) {
        params.set("exclude", excludeIds.join(","));
      }

      const response = await fetch(`/api/public/manga-gallery?${params}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`Failed to load manga: ${response.status}`);
      }

      const payload = (await response.json()) as { manga?: Manga[] };
      const nextManga = payload.manga ?? [];
      const nextIds = new Set(mangaRef.current.map((item) => item.id));
      const uniqueNextManga = nextManga.filter((item) => !nextIds.has(item.id));

      setManga((current) => {
        const merged = [...current, ...uniqueNextManga];
        mangaRef.current = merged;
        return merged;
      });

      const nextHasMore = nextManga.length >= pageSize;
      hasMoreRef.current = nextHasMore;
    } catch (error) {
      console.error("[Public manga] Failed to load more manga.", error);
      hasMoreRef.current = false;
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }, [filters.author, filters.query, filters.tag, pageSize]);

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { rootMargin: "800px 0px" },
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <>
      <MangaGrid manga={manga} />
      <div ref={sentinelRef} className="h-10" aria-hidden="true" />
      {isLoading ? (
        <p className="py-4 text-center text-sm font-medium text-stone-400">
          読み込み中
        </p>
      ) : null}
    </>
  );
}
