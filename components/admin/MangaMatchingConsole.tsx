"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ExternalLink,
  Link2,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  SkipForward,
} from "lucide-react";
import type {
  MangaSeriesCandidate,
  MatchingIssue,
} from "@/lib/admin/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type IssueResponse = {
  issues: MatchingIssue[];
  page: number;
  pageSize: number;
  total: number;
};

type StatusFilter = "unresolved" | "resolved" | "all";

export function MangaMatchingConsole() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [issues, setIssues] = useState<MatchingIssue[]>([]);
  const [selectedIsbn, setSelectedIsbn] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("unresolved");
  const [issueSearch, setIssueSearch] = useState("");
  const [seriesSearch, setSeriesSearch] = useState("");
  const [series, setSeries] = useState<MangaSeriesCandidate[]>([]);
  const [applyToGroup, setApplyToGroup] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [linkingSeriesId, setLinkingSeriesId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showCreateSeries, setShowCreateSeries] = useState(false);
  const [newSeriesTitle, setNewSeriesTitle] = useState("");

  const selectedIssue = useMemo(
    () => issues.find((issue) => issue.isbn === selectedIsbn) ?? issues[0],
    [issues, selectedIsbn],
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

  const loadIssues = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
      status,
    });

    if (issueSearch.trim()) {
      params.set("q", issueSearch.trim());
    }

    const response = await authorizedFetch(
      `/api/admin/matching/issues?${params}`,
    );

    if (response.status === 401) {
      await createSupabaseBrowserClient().auth.signOut();
      router.replace("/admin/login");
      return;
    }

    if (!response.ok) {
      setError("未対応データを取得できませんでした。");
      setIsLoading(false);
      return;
    }

    const data = (await response.json()) as IssueResponse;
    setIssues(data.issues);
    setTotal(data.total);
    setSelectedIsbn((current) =>
      data.issues.some((issue) => issue.isbn === current)
        ? current
        : (data.issues[0]?.isbn ?? ""),
    );
    setIsLoading(false);
  }, [accessToken, authorizedFetch, issueSearch, page, router, status]);

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
    const timeout = window.setTimeout(() => void loadIssues(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadIssues]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSeries([]);
      setSeriesSearch(selectedIssue?.normalizedTitle ?? "");
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [selectedIssue?.isbn, selectedIssue?.normalizedTitle]);

  useEffect(() => {
    if (!accessToken || !seriesSearch.trim()) {
      const timeout = window.setTimeout(() => setSeries([]), 0);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(async () => {
      setIsSearching(true);
      const response = await authorizedFetch(
        `/api/admin/matching/series?q=${encodeURIComponent(seriesSearch.trim())}`,
      );

      if (response.ok) {
        const data = (await response.json()) as {
          series: MangaSeriesCandidate[];
        };
        setSeries(data.series);
      } else {
        setSeries([]);
      }
      setIsSearching(false);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [accessToken, authorizedFetch, seriesSearch]);

  async function linkToSeries(seriesId: string) {
    if (!selectedIssue) {
      return;
    }

    setIsMutating(true);
    setLinkingSeriesId(seriesId);
    setError("");
    const response = await authorizedFetch("/api/admin/matching/link", {
      method: "POST",
      body: JSON.stringify({
        isbn: selectedIssue.isbn,
        seriesId,
        applyToGroup,
      }),
    });

    if (!response.ok) {
      setError("シリーズへ紐づけできませんでした。");
      setIsMutating(false);
      setLinkingSeriesId(null);
      return;
    }

    await loadIssues();
    setIsMutating(false);
    setLinkingSeriesId(null);
  }

  async function ignoreIssue() {
    if (!selectedIssue) {
      return;
    }

    setIsMutating(true);
    const response = await authorizedFetch("/api/admin/matching/ignore", {
      method: "POST",
      body: JSON.stringify({ isbn: selectedIssue.isbn }),
    });

    if (!response.ok) {
      setError("対応済みに変更できませんでした。");
      setIsMutating(false);
      return;
    }

    await loadIssues();
    setIsMutating(false);
  }

  async function createAndLinkSeries(event: React.FormEvent) {
    event.preventDefault();

    if (!newSeriesTitle.trim() || !selectedIssue) {
      return;
    }

    setIsMutating(true);
    const createResponse = await authorizedFetch(
      "/api/admin/matching/series",
      {
        method: "POST",
        body: JSON.stringify({ title: newSeriesTitle }),
      },
    );

    if (!createResponse.ok) {
      setError("シリーズを作成できませんでした。");
      setIsMutating(false);
      return;
    }

    const data = (await createResponse.json()) as {
      series: MangaSeriesCandidate;
    };
    setShowCreateSeries(false);
    setNewSeriesTitle("");
    await linkToSeries(data.series.id);
  }

  async function logout() {
    await createSupabaseBrowserClient().auth.signOut();
    router.replace("/admin/login");
  }

  const pageCount = Math.max(1, Math.ceil(total / 50));

  return (
    <main className="min-h-[calc(100vh-65px)] bg-stone-100">
      <div className="border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-stone-950">
              シリーズ紐づけ管理
            </h1>
            <p className="text-xs text-stone-500">
              {total.toLocaleString("ja-JP")}件
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="再読み込み"
              onClick={() => void loadIssues()}
              className="flex size-9 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-100"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100"
            >
              <LogOut className="size-4" aria-hidden="true" />
              ログアウト
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1600px] grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)_420px]">
        <aside className="border-r border-stone-200 bg-white xl:h-[calc(100vh-130px)]">
          <div className="space-y-3 border-b border-stone-200 p-3">
            <div className="grid grid-cols-3 rounded-md bg-stone-100 p-1">
              {(["unresolved", "resolved", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setStatus(value);
                    setPage(1);
                  }}
                  className={`h-8 rounded text-xs font-semibold ${
                    status === value
                      ? "bg-white text-stone-950 shadow-sm"
                      : "text-stone-500"
                  }`}
                >
                  {value === "unresolved"
                    ? "未対応"
                    : value === "resolved"
                      ? "対応済み"
                      : "すべて"}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                void loadIssues();
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-2.5 size-4 text-stone-400" />
                <input
                  value={issueSearch}
                  onChange={(event) => setIssueSearch(event.target.value)}
                  placeholder="ISBN / 正規化タイトル"
                  className="h-9 w-full rounded-md border border-stone-300 pl-9 pr-3 text-sm outline-none focus:border-cyan-700"
                />
              </div>
            </form>
          </div>

          <div className="max-h-[60vh] overflow-y-auto xl:max-h-[calc(100vh-273px)]">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <LoaderCircle className="size-5 animate-spin text-cyan-700" />
              </div>
            ) : issues.length === 0 ? (
              <p className="p-6 text-center text-sm text-stone-500">
                対象データはありません
              </p>
            ) : (
              issues.map((issue) => (
                <button
                  key={issue.isbn}
                  type="button"
                  onClick={() => setSelectedIsbn(issue.isbn)}
                  className={`flex w-full gap-3 border-b border-stone-100 p-3 text-left ${
                    selectedIssue?.isbn === issue.isbn
                      ? "bg-cyan-50"
                      : "hover:bg-stone-50"
                  }`}
                >
                  <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded bg-stone-200">
                    {issue.coverImageUrl ? (
                      <Image
                        src={issue.coverImageUrl}
                        alt=""
                        fill
                        sizes="44px"
                        className="object-cover"
                      />
                    ) : (
                      <BookOpen className="absolute inset-0 m-auto size-5 text-stone-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-semibold text-stone-900">
                      {issue.title}
                    </p>
                    <p className="mt-1 truncate text-xs text-stone-500">
                      {issue.author || "著者不明"}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-stone-400">
                      {issue.isbn}
                    </p>
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

        <section className="min-w-0 border-r border-stone-200 p-5 xl:h-[calc(100vh-130px)] xl:overflow-y-auto">
          {selectedIssue ? (
            <div className="mx-auto max-w-3xl">
              <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
                <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-stone-200">
                  {selectedIssue.coverImageUrl ? (
                    <Image
                      src={selectedIssue.coverImageUrl}
                      alt={`${selectedIssue.title}の表紙`}
                      fill
                      sizes="180px"
                      className="object-cover"
                    />
                  ) : (
                    <BookOpen className="absolute inset-0 m-auto size-10 text-stone-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                      {selectedIssue.issueType}
                    </span>
                    {selectedIssue.isResolved ? (
                      <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">
                        対応済み
                      </span>
                    ) : null}
                  </div>
                  <h2 className="text-xl font-bold leading-8 text-stone-950">
                    {selectedIssue.title}
                  </h2>
                  <dl className="mt-5 grid gap-3 text-sm">
                    <DetailRow label="正規化">
                      <code className="break-all text-cyan-800">
                        {selectedIssue.normalizedTitle}
                      </code>
                    </DetailRow>
                    <DetailRow label="ISBN">{selectedIssue.isbn}</DetailRow>
                    <DetailRow label="著者">
                      {selectedIssue.author || "未設定"}
                    </DetailRow>
                    <DetailRow label="出版社">
                      {selectedIssue.publisherName || "未設定"}
                    </DetailRow>
                    <DetailRow label="発売日">
                      {selectedIssue.salesDate || "未設定"}
                    </DetailRow>
                  </dl>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {selectedIssue.itemUrl ? (
                      <a
                        href={selectedIssue.itemUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 hover:bg-stone-50"
                      >
                        <ExternalLink className="size-4" />
                        楽天で確認
                      </a>
                    ) : null}
                    {!selectedIssue.isResolved ? (
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => void ignoreIssue()}
                        className="flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                      >
                        <SkipForward className="size-4" />
                        対応不要
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              {error ? (
                <p className="mt-5 border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-stone-500">
              左の一覧からアイテムを選択
            </div>
          )}
        </section>

        <aside className="bg-white p-4 xl:h-[calc(100vh-130px)] xl:overflow-y-auto">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-stone-950">シリーズ候補</h2>
            <button
              type="button"
              title="新規シリーズ"
              onClick={() => {
                setNewSeriesTitle(selectedIssue?.normalizedTitle ?? "");
                setShowCreateSeries((current) => !current);
              }}
              className="flex size-8 items-center justify-center rounded-md border border-stone-300 hover:bg-stone-50"
            >
              <Plus className="size-4" />
            </button>
          </div>

          {showCreateSeries ? (
            <form
              className="mb-4 space-y-2 border-b border-stone-200 pb-4"
              onSubmit={(event) => void createAndLinkSeries(event)}
            >
              <input
                required
                value={newSeriesTitle}
                onChange={(event) => setNewSeriesTitle(event.target.value)}
                placeholder="新しいシリーズ名"
                className="h-9 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
              />
              <button
                type="submit"
                disabled={isMutating}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-bold text-white disabled:opacity-50"
              >
                <Plus className="size-4" />
                作成して紐づけ
              </button>
            </form>
          ) : null}

          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-4 text-stone-400" />
            <input
              value={seriesSearch}
              onChange={(event) => setSeriesSearch(event.target.value)}
              placeholder="シリーズタイトル"
              className="h-9 w-full rounded-md border border-stone-300 pl-9 pr-3 text-sm outline-none focus:border-cyan-700"
            />
          </div>

          <label className="my-3 flex items-center gap-2 text-xs font-medium text-stone-600">
            <input
              type="checkbox"
              checked={applyToGroup}
              onChange={(event) => setApplyToGroup(event.target.checked)}
              className="size-4 accent-cyan-700"
            />
            同じ正規化タイトルをまとめて紐づけ
          </label>

          {isSearching ? (
            <div className="flex h-24 items-center justify-center">
              <LoaderCircle className="size-5 animate-spin text-cyan-700" />
            </div>
          ) : (
            <div className="space-y-2">
              {series.map((candidate) => (
                <div
                  key={candidate.id}
                  className="rounded-md border border-stone-200 p-3"
                >
                  <p className="text-sm font-bold text-stone-900">
                    {candidate.title}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-stone-500">
                    {candidate.normalizedTitle}
                  </p>
                  <button
                    type="button"
                    disabled={isMutating || selectedIssue?.isResolved}
                    onClick={() => void linkToSeries(candidate.id)}
                    className="mt-3 flex h-8 w-full items-center justify-center gap-2 rounded-md bg-cyan-700 px-3 text-xs font-bold text-white hover:bg-cyan-800 disabled:opacity-40"
                  >
                    {linkingSeriesId === candidate.id ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Link2 className="size-4" />
                    )}
                    紐づけ
                  </button>
                </div>
              ))}
              {!seriesSearch.trim() ? (
                <p className="py-8 text-center text-sm text-stone-500">
                  シリーズ名を入力
                </p>
              ) : !isSearching && series.length === 0 ? (
                <p className="py-8 text-center text-sm text-stone-500">
                  候補がありません
                </p>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 border-b border-stone-200 pb-2">
      <dt className="font-semibold text-stone-500">{label}</dt>
      <dd className="min-w-0 text-stone-800">{children}</dd>
    </div>
  );
}
