"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ExternalLink,
  Link2Off,
  ListChecks,
  LoaderCircle,
  LogOut,
  Pencil,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type {
  ManagedMangaSeries,
  ManagedSeriesItem,
} from "@/lib/admin/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SeriesResponse = {
  series: ManagedMangaSeries[];
  page: number;
  pageSize: number;
  total: number;
};

type SeriesDetailResponse = {
  series: ManagedMangaSeries;
  items: ManagedSeriesItem[];
};

type SeriesManagementConsoleProps = {
  initialQuery?: string;
};

export function SeriesManagementConsole({
  initialQuery = "",
}: SeriesManagementConsoleProps) {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [series, setSeries] = useState<ManagedMangaSeries[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [selectedSeries, setSelectedSeries] =
    useState<ManagedMangaSeries | null>(null);
  const [items, setItems] = useState<ManagedSeriesItem[]>([]);
  const [queryText, setQueryText] = useState(initialQuery);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [unlinkingIsbn, setUnlinkingIsbn] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);
  const [error, setError] = useState("");

  const pageCount = Math.max(1, Math.ceil(total / 50));
  const currentSeries = useMemo(
    () =>
      selectedSeries ??
      series.find((entry) => entry.id === selectedSeriesId) ??
      null,
    [selectedSeries, selectedSeriesId, series],
  );

  const authorizedFetch = useCallback(
    (input: string, init?: RequestInit) =>
      fetch(input, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
          Authorization: `Bearer ${accessToken}`,
        },
      }),
    [accessToken],
  );

  const handleUnauthorized = useCallback(async () => {
    await createSupabaseBrowserClient().auth.signOut();
    router.replace("/admin/login");
  }, [router]);

  const loadSeries = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
    });

    if (queryText.trim()) {
      params.set("q", queryText.trim());
    }

    const response = await authorizedFetch(`/api/admin/series?${params}`);

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("シリーズ一覧を取得できませんでした。");
      setIsLoading(false);
      return;
    }

    const data = (await response.json()) as SeriesResponse;
    setSeries(data.series);
    setTotal(data.total);
    setSelectedSeriesId((current) =>
      data.series.some((entry) => entry.id === current)
        ? current
        : (data.series[0]?.id ?? ""),
    );
    setIsLoading(false);
  }, [
    accessToken,
    authorizedFetch,
    handleUnauthorized,
    page,
    queryText,
  ]);

  const loadSeriesDetail = useCallback(
    async (seriesId: string) => {
      if (!accessToken || !seriesId) {
        setSelectedSeries(null);
        setItems([]);
        return;
      }

      setIsDetailLoading(true);
      setError("");
      const response = await authorizedFetch(`/api/admin/series/${seriesId}`);

      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }

      if (!response.ok) {
        setError("シリーズの詳細を取得できませんでした。");
        setIsDetailLoading(false);
        return;
      }

      const data = (await response.json()) as SeriesDetailResponse;
      setSelectedSeries(data.series);
      setEditedTitle(data.series.title);
      setIsEditingTitle(false);
      setItems(data.items);
      setIsDetailLoading(false);
    },
    [accessToken, authorizedFetch, handleUnauthorized],
  );

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace("/admin/login");
        return;
      }

      setAccessToken(data.session.access_token);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setAccessToken(session.access_token);
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadSeries(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadSeries]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => void loadSeriesDetail(selectedSeriesId),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [loadSeriesDetail, selectedSeriesId]);

  async function unlinkItem(item: ManagedSeriesItem) {
    if (!selectedSeriesId) {
      return;
    }

    const confirmed = window.confirm(
      `「${item.title}」の紐づけを解除し、未対応issueへ戻しますか？`,
    );

    if (!confirmed) {
      return;
    }

    setUnlinkingIsbn(item.isbn);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/items/${encodeURIComponent(item.isbn)}`,
      { method: "DELETE" },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("紐づけを解除できませんでした。");
      setUnlinkingIsbn(null);
      return;
    }

    await Promise.all([
      loadSeriesDetail(selectedSeriesId),
      loadSeries(),
    ]);
    setUnlinkingIsbn(null);
  }

  async function updateTitle(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedSeriesId || !editedTitle.trim()) {
      return;
    }

    setIsUpdatingTitle(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ title: editedTitle.trim() }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError(
        response.status === 409
          ? "同じタイトルのシリーズがすでに存在します。"
          : "シリーズタイトルを更新できませんでした。",
      );
      setIsUpdatingTitle(false);
      return;
    }

    const data = (await response.json()) as {
      series: Omit<ManagedMangaSeries, "itemCount">;
    };
    const updatedSeries = {
      ...data.series,
      itemCount: items.length,
    };

    setSelectedSeries(updatedSeries);
    setSeries((current) =>
      current.map((entry) =>
        entry.id === updatedSeries.id
          ? { ...entry, ...updatedSeries }
          : entry,
      ),
    );
    setEditedTitle(updatedSeries.title);
    setIsEditingTitle(false);
    setIsUpdatingTitle(false);
  }

  async function logout() {
    await createSupabaseBrowserClient().auth.signOut();
    router.replace("/admin/login");
  }

  return (
    <main className="min-h-[calc(100vh-65px)] bg-stone-100">
      <div className="border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-stone-950">シリーズ管理</h1>
            <p className="text-xs text-stone-500">
              {total.toLocaleString("ja-JP")}シリーズ
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/manga-matching"
              className="flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100"
            >
              <ListChecks className="size-4" />
              issue管理
            </Link>
            <button
              type="button"
              title="再読み込み"
              onClick={() => void loadSeries()}
              className="flex size-9 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-100"
            >
              <RefreshCw className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100"
            >
              <LogOut className="size-4" />
              ログアウト
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="border-r border-stone-200 bg-white xl:h-[calc(100vh-130px)]">
          <form
            className="border-b border-stone-200 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              void loadSeries();
            }}
          >
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-stone-400" />
              <input
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                placeholder="シリーズ名で検索"
                className="h-9 w-full rounded-md border border-stone-300 pl-9 pr-3 text-sm outline-none focus:border-cyan-700"
              />
            </div>
          </form>

          <div className="max-h-[60vh] overflow-y-auto xl:max-h-[calc(100vh-227px)]">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <LoaderCircle className="size-5 animate-spin text-cyan-700" />
              </div>
            ) : series.length === 0 ? (
              <p className="p-6 text-center text-sm text-stone-500">
                シリーズがありません
              </p>
            ) : (
              series.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    setSelectedSeries(null);
                    setSelectedSeriesId(entry.id);
                  }}
                  className={`w-full border-b border-stone-100 p-3 text-left ${
                    selectedSeriesId === entry.id
                      ? "bg-cyan-50"
                      : "hover:bg-stone-50"
                  }`}
                >
                  <p className="text-sm font-semibold text-stone-900">
                    {entry.title}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <p className="truncate font-mono text-[11px] text-stone-400">
                      {entry.normalizedTitle}
                    </p>
                    <span className="shrink-0 text-xs font-semibold text-cyan-800">
                      {entry.itemCount}冊
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="flex h-12 items-center justify-between border-t border-stone-200 px-3">
            <button
              type="button"
              title="前のページ"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              className="flex size-8 items-center justify-center rounded-md border border-stone-300 disabled:opacity-40"
            >
              <ArrowLeft className="size-4" />
            </button>
            <span className="text-xs font-medium text-stone-500">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              title="次のページ"
              disabled={page >= pageCount}
              onClick={() => setPage((current) => current + 1)}
              className="flex size-8 items-center justify-center rounded-md border border-stone-300 disabled:opacity-40"
            >
              <ArrowRight className="size-4" />
            </button>
          </div>
        </aside>

        <section className="min-w-0 p-4 sm:p-6 xl:h-[calc(100vh-130px)] xl:overflow-y-auto">
          {isDetailLoading ? (
            <div className="flex h-56 items-center justify-center">
              <LoaderCircle className="size-6 animate-spin text-cyan-700" />
            </div>
          ) : currentSeries ? (
            <div className="mx-auto max-w-5xl">
              <div className="border-b border-stone-300 pb-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    {isEditingTitle ? (
                      <form
                        onSubmit={(event) => void updateTitle(event)}
                        className="flex max-w-2xl items-center gap-2"
                      >
                        <input
                          autoFocus
                          value={editedTitle}
                          onChange={(event) => setEditedTitle(event.target.value)}
                          className="h-10 min-w-0 flex-1 rounded-md border border-stone-300 px-3 text-base font-bold outline-none focus:border-cyan-700"
                        />
                        <button
                          type="submit"
                          title="保存"
                          disabled={
                            isUpdatingTitle ||
                            !editedTitle.trim() ||
                            editedTitle.trim() === currentSeries.title
                          }
                          className="flex size-10 items-center justify-center rounded-md bg-cyan-700 text-white hover:bg-cyan-800 disabled:opacity-40"
                        >
                          {isUpdatingTitle ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Check className="size-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          title="キャンセル"
                          disabled={isUpdatingTitle}
                          onClick={() => {
                            setEditedTitle(currentSeries.title);
                            setIsEditingTitle(false);
                          }}
                          className="flex size-10 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                        >
                          <X className="size-4" />
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-stone-950">
                          {currentSeries.title}
                        </h2>
                        <button
                          type="button"
                          title="タイトルを編集"
                          onClick={() => {
                            setEditedTitle(currentSeries.title);
                            setIsEditingTitle(true);
                          }}
                          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
                        >
                          <Pencil className="size-4" />
                        </button>
                      </div>
                    )}
                    <p className="mt-1 break-all font-mono text-xs text-stone-500">
                      {currentSeries.normalizedTitle}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-cyan-800">
                    {items.length}冊
                  </span>
                </div>
                {currentSeries.description ? (
                  <p className="mt-3 text-sm leading-6 text-stone-600">
                    {currentSeries.description}
                  </p>
                ) : null}
              </div>

              {error ? (
                <p className="mt-4 border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              ) : null}

              {items.length === 0 ? (
                <div className="py-20 text-center text-sm text-stone-500">
                  このシリーズに紐づくアイテムはありません
                </div>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {items.map((item) => (
                    <article
                      key={item.isbn}
                      className="grid min-w-0 grid-cols-[76px_minmax(0,1fr)] gap-3 rounded-md border border-stone-200 bg-white p-3"
                    >
                      {item.rawResponse ? (
                        <pre hidden data-rakuten-api-data>
                          {JSON.stringify(item.rawResponse, null, 2)}
                        </pre>
                      ) : null}
                      <div className="relative aspect-[2/3] overflow-hidden rounded bg-stone-200">
                        {item.coverImageUrl ? (
                          <Image
                            src={item.coverImageUrl}
                            alt=""
                            fill
                            sizes="76px"
                            className="object-cover"
                          />
                        ) : (
                          <BookOpen className="absolute inset-0 m-auto size-6 text-stone-400" />
                        )}
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <h3 className="text-sm font-bold leading-5 text-stone-900">
                          {item.title}
                        </h3>
                        <p className="mt-1 text-xs text-stone-500">
                          {item.author || "著者未設定"}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-stone-400">
                          {item.isbn}
                        </p>
                        <p className="mt-1 text-[11px] text-stone-400">
                          {item.matchMethod} / {item.salesDate || "発売日未設定"}
                        </p>
                        <div className="mt-auto flex gap-2 pt-3">
                          {item.itemUrl ? (
                            <a
                              href={item.itemUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="楽天で確認"
                              className="flex size-8 items-center justify-center rounded-md border border-stone-300 text-stone-600 hover:bg-stone-50"
                            >
                              <ExternalLink className="size-4" />
                            </a>
                          ) : null}
                          <button
                            type="button"
                            disabled={unlinkingIsbn !== null}
                            onClick={() => void unlinkItem(item)}
                            className="flex h-8 flex-1 items-center justify-center gap-2 rounded-md border border-red-300 px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-40"
                          >
                            {unlinkingIsbn === item.isbn ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                              <Link2Off className="size-4" />
                            )}
                            紐づけ解除
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="py-20 text-center text-sm text-stone-500">
              シリーズを選択してください
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
