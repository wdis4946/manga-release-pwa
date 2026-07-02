"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type {
  ManagedMangaSeries,
  ManagedSeriesCategory,
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
  categories: ManagedSeriesCategory[];
  items: ManagedSeriesItem[];
};

type BulkUnlinkResponse = {
  unlinkedCount?: number;
  missingIsbns?: string[];
};

type SeriesManagementConsoleProps = {
  initialQuery?: string;
};

type CategoryDraft = {
  categoryNumber: string;
  categoryName: string;
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
  const [categories, setCategories] = useState<ManagedSeriesCategory[]>([]);
  const [items, setItems] = useState<ManagedSeriesItem[]>([]);
  const [queryText, setQueryText] = useState(initialQuery);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [unlinkingIsbn, setUnlinkingIsbn] = useState<string | null>(null);
  const [isBulkUnlinking, setIsBulkUnlinking] = useState(false);
  const [selectedItemIsbns, setSelectedItemIsbns] = useState<Set<string>>(
    () => new Set(),
  );
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);
  const [isEditingSearchTitle, setIsEditingSearchTitle] = useState(false);
  const [editedSearchTitle, setEditedSearchTitle] = useState("");
  const [isUpdatingSearchTitle, setIsUpdatingSearchTitle] = useState(false);
  const [categoryDrafts, setCategoryDrafts] = useState<
    Record<string, CategoryDraft>
  >({});
  const [newCategoryNumber, setNewCategoryNumber] = useState("1");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [savingCategoryNumber, setSavingCategoryNumber] = useState<
    number | null
  >(null);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [movingItemIsbn, setMovingItemIsbn] = useState<string | null>(null);
  const [bulkMoveCategoryNumber, setBulkMoveCategoryNumber] = useState("0");
  const [isBulkMoving, setIsBulkMoving] = useState(false);
  const [isDeletingSeries, setIsDeletingSeries] = useState(false);
  const [deletingCategoryNumber, setDeletingCategoryNumber] = useState<
    number | null
  >(null);
  const [error, setError] = useState("");
  const seriesRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);

  const pageCount = Math.max(1, Math.ceil(total / 50));
  const currentSeries = useMemo(
    () =>
      selectedSeries ??
      series.find((entry) => entry.id === selectedSeriesId) ??
      null,
    [selectedSeries, selectedSeriesId, series],
  );
  const selectedVisibleItemIsbns = useMemo(
    () => items.filter((item) => selectedItemIsbns.has(item.isbn)),
    [items, selectedItemIsbns],
  );
  const areAllVisibleItemsSelected =
    items.length > 0 && selectedVisibleItemIsbns.length === items.length;
  const itemGroups = useMemo(() => {
    const groups = new Map<
      number,
      ManagedSeriesCategory & { items: ManagedSeriesItem[] }
    >();

    for (const category of categories) {
      groups.set(category.categoryNumber, {
        ...category,
        items: [],
      });
    }

    for (const item of items) {
      const group =
        groups.get(item.categoryNumber) ??
        {
          categoryNumber: item.categoryNumber,
          categoryName: item.categoryName,
          itemCount: 0,
          items: [],
        };

      group.items.push(item);
      group.itemCount = group.items.length;
      groups.set(item.categoryNumber, group);
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        items: [...group.items].sort((left, right) =>
          left.isbn.localeCompare(right.isbn),
        ),
      }))
      .sort(
        (left, right) =>
          left.categoryNumber - right.categoryNumber ||
          left.categoryName.localeCompare(right.categoryName),
      );
  }, [categories, items]);

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

    const requestId = seriesRequestIdRef.current + 1;
    seriesRequestIdRef.current = requestId;
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

    if (requestId !== seriesRequestIdRef.current) {
      return;
    }

    if (!response.ok) {
      setError("シリーズ一覧を取得できませんでした。");
      setIsLoading(false);
      return;
    }

    const data = (await response.json()) as SeriesResponse;
    if (requestId !== seriesRequestIdRef.current) {
      return;
    }

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
        detailRequestIdRef.current += 1;
        setSelectedSeries(null);
        setCategories([]);
        setItems([]);
        return;
      }

      const requestId = detailRequestIdRef.current + 1;
      detailRequestIdRef.current = requestId;
      setIsDetailLoading(true);
      setError("");
      const response = await authorizedFetch(`/api/admin/series/${seriesId}`);

      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }

      if (requestId !== detailRequestIdRef.current) {
        return;
      }

      if (!response.ok) {
        setError("シリーズの詳細を取得できませんでした。");
        setIsDetailLoading(false);
        return;
      }

      const data = (await response.json()) as SeriesDetailResponse;
      if (requestId !== detailRequestIdRef.current) {
        return;
      }

      setSelectedSeries(data.series);
      setEditedTitle(data.series.displayTitle);
      setEditedSearchTitle(data.series.searchTitle);
      setCategories(data.categories);
      setCategoryDrafts(
        Object.fromEntries(
          data.categories.map((category) => [
            String(category.categoryNumber),
            {
              categoryNumber: String(category.categoryNumber),
              categoryName: category.categoryName,
            },
          ]),
        ),
      );
      setBulkMoveCategoryNumber(String(data.categories[0]?.categoryNumber ?? 0));
      setNewCategoryNumber(
        String(
          Math.max(0, ...data.categories.map((category) => category.categoryNumber)) +
            1,
        ),
      );
      setNewCategoryName("");
      setIsEditingTitle(false);
      setIsEditingSearchTitle(false);
      setItems(data.items);
      setSelectedItemIsbns(new Set());
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
    const timeout = window.setTimeout(() => void loadSeries(), 250);
    return () => window.clearTimeout(timeout);
  }, [loadSeries]);

  useEffect(() => {
    seriesRequestIdRef.current += 1;
  }, [page, queryText]);

  useEffect(() => {
    detailRequestIdRef.current += 1;
  }, [selectedSeriesId]);

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
    setSelectedItemIsbns((current) => {
      const next = new Set(current);
      next.delete(item.isbn);
      return next;
    });
    setUnlinkingIsbn(null);
  }

  function toggleItemSelection(isbn: string) {
    setSelectedItemIsbns((current) => {
      const next = new Set(current);

      if (next.has(isbn)) {
        next.delete(isbn);
      } else {
        next.add(isbn);
      }

      return next;
    });
  }

  function toggleVisibleItemsSelection() {
    setSelectedItemIsbns((current) => {
      if (areAllVisibleItemsSelected) {
        return new Set();
      }

      const next = new Set(current);
      for (const item of items) {
        next.add(item.isbn);
      }
      return next;
    });
  }

  async function bulkUnlinkItems() {
    if (!selectedSeriesId || selectedVisibleItemIsbns.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `選択した${selectedVisibleItemIsbns.length}件の紐づけを解除し、未対応issueへ戻しますか？`,
    );

    if (!confirmed) {
      return;
    }

    setIsBulkUnlinking(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/items`,
      {
        method: "DELETE",
        body: JSON.stringify({
          isbns: selectedVisibleItemIsbns.map((item) => item.isbn),
        }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("選択したアイテムの紐づけを解除できませんでした。");
      setIsBulkUnlinking(false);
      return;
    }

    const data = (await response.json()) as BulkUnlinkResponse;
    if ((data.missingIsbns?.length ?? 0) > 0) {
      setError(
        `${data.unlinkedCount ?? 0}件を解除しました。一部のISBNは既に紐づけが見つかりませんでした。`,
      );
    }

    await Promise.all([
      loadSeriesDetail(selectedSeriesId),
      loadSeries(),
    ]);
    setSelectedItemIsbns(new Set());
    setIsBulkUnlinking(false);
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
        body: JSON.stringify({ displayTitle: editedTitle.trim() }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError(
        response.status === 409
          ? "同じタイトルのシリーズが既に存在します。"
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
    setEditedTitle(updatedSeries.displayTitle);
    setIsEditingTitle(false);
    setIsUpdatingTitle(false);
  }

  async function updateSearchTitle(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedSeriesId || !editedSearchTitle.trim()) {
      return;
    }

    setIsUpdatingSearchTitle(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ searchTitle: editedSearchTitle.trim() }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError(
        response.status === 409
          ? "同じ検索用タイトルのシリーズが既に存在します。"
          : "検索用タイトルを更新できませんでした。",
      );
      setIsUpdatingSearchTitle(false);
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
    setEditedSearchTitle(updatedSeries.searchTitle);
    setIsEditingSearchTitle(false);
    setIsUpdatingSearchTitle(false);
  }

  function updateCategoryDraft(
    originalCategoryNumber: number,
    patch: Partial<CategoryDraft>,
  ) {
    setCategoryDrafts((current) => {
      const key = String(originalCategoryNumber);
      return {
        ...current,
        [key]: {
          categoryNumber:
            current[key]?.categoryNumber ?? String(originalCategoryNumber),
          categoryName: current[key]?.categoryName ?? "default",
          ...patch,
        },
      };
    });
  }

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedSeriesId || !newCategoryName.trim()) {
      return;
    }

    const categoryNumber = Number(newCategoryNumber);

    if (!Number.isInteger(categoryNumber) || categoryNumber < 0) {
      setError("カテゴリ番号は0以上の整数で入力してください。");
      return;
    }

    setIsAddingCategory(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/categories`,
      {
        method: "POST",
        body: JSON.stringify({
          categoryNumber,
          categoryName: newCategoryName.trim(),
        }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError(
        response.status === 409
          ? "同じカテゴリ番号が既に存在します。"
          : "カテゴリを追加できませんでした。",
      );
      setIsAddingCategory(false);
      return;
    }

    await loadSeriesDetail(selectedSeriesId);
    setIsAddingCategory(false);
  }

  async function saveCategory(category: ManagedSeriesCategory) {
    if (!selectedSeriesId) {
      return;
    }

    const draft = categoryDrafts[String(category.categoryNumber)];
    const nextCategoryNumber = Number(draft?.categoryNumber);
    const nextCategoryName = draft?.categoryName.trim();

    if (!Number.isInteger(nextCategoryNumber) || nextCategoryNumber < 0) {
      setError("カテゴリ番号は0以上の整数で入力してください。");
      return;
    }

    if (!nextCategoryName) {
      setError("カテゴリ名を入力してください。");
      return;
    }

    setSavingCategoryNumber(category.categoryNumber);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/categories/${category.categoryNumber}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          categoryNumber: nextCategoryNumber,
          categoryName: nextCategoryName,
        }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError(
        response.status === 409
          ? "同じカテゴリ番号が既に存在します。"
          : "カテゴリを保存できませんでした。",
      );
      setSavingCategoryNumber(null);
      return;
    }

    await loadSeriesDetail(selectedSeriesId);
    setSavingCategoryNumber(null);
  }

  async function moveItemsToCategory(isbns: string[], categoryNumber: number) {
    if (!selectedSeriesId || isbns.length === 0) {
      return false;
    }

    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/items`,
      {
        method: "PATCH",
        body: JSON.stringify({ isbns, categoryNumber }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return false;
    }

    if (!response.ok) {
      setError("カテゴリを移動できませんでした。");
      return false;
    }

    await loadSeriesDetail(selectedSeriesId);
    return true;
  }

  async function moveItemToCategory(
    item: ManagedSeriesItem,
    categoryNumber: number,
  ) {
    if (item.categoryNumber === categoryNumber) {
      return;
    }

    setMovingItemIsbn(item.isbn);
    setError("");
    await moveItemsToCategory([item.isbn], categoryNumber);
    setMovingItemIsbn(null);
  }

  async function bulkMoveSelectedItems() {
    const categoryNumber = Number(bulkMoveCategoryNumber);

    if (!Number.isInteger(categoryNumber) || categoryNumber < 0) {
      setError("移動先カテゴリを選択してください。");
      return;
    }

    setIsBulkMoving(true);
    setError("");
    const moved = await moveItemsToCategory(
      selectedVisibleItemIsbns.map((item) => item.isbn),
      categoryNumber,
    );

    if (moved) {
      setSelectedItemIsbns(new Set());
    }

    setIsBulkMoving(false);
  }

  async function deleteSeries() {
    if (!selectedSeriesId || !currentSeries) {
      return;
    }

    const confirmed = window.confirm(
      `「${currentSeries.displayTitle}」を削除しますか？紐づきカテゴリとアイテムの紐づけも削除されます。`,
    );

    if (!confirmed) {
      return;
    }

    setIsDeletingSeries(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}`,
      { method: "DELETE" },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("シリーズを削除できませんでした。");
      setIsDeletingSeries(false);
      return;
    }

    setSelectedSeriesId("");
    setSelectedSeries(null);
    setCategories([]);
    setItems([]);
    setSelectedItemIsbns(new Set());
    await loadSeries();
    setIsDeletingSeries(false);
  }

  async function deleteCategory(category: ManagedSeriesCategory) {
    if (!selectedSeriesId) {
      return;
    }

    const confirmed = window.confirm(
      `カテゴリ「${category.categoryName}」を削除しますか？アイテムが入っているカテゴリは削除できません。`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingCategoryNumber(category.categoryNumber);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/categories/${category.categoryNumber}`,
      { method: "DELETE" },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError(
        response.status === 409
          ? "アイテムが入っているカテゴリは削除できません。先に別カテゴリへ移動してください。"
          : "カテゴリを削除できませんでした。",
      );
      setDeletingCategoryNumber(null);
      return;
    }

    await loadSeriesDetail(selectedSeriesId);
    setDeletingCategoryNumber(null);
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
              紐づけ管理
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
                    {entry.displayTitle}
                  </p>
                  {entry.searchTitle !== entry.displayTitle ? (
                    <p className="mt-1 truncate text-xs text-stone-500">
                      検索用: {entry.searchTitle}
                    </p>
                  ) : null}
                  <div className="mt-1 flex items-center justify-between gap-3">
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
                            editedTitle.trim() === currentSeries.displayTitle
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
                            setEditedTitle(currentSeries.displayTitle);
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
                          {currentSeries.displayTitle}
                        </h2>
                        <button
                          type="button"
                          title="タイトルを編集"
                          onClick={() => {
                            setEditedTitle(currentSeries.displayTitle);
                            setIsEditingTitle(true);
                          }}
                          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
                        >
                          <Pencil className="size-4" />
                        </button>
                      </div>
                    )}
                    {isEditingSearchTitle ? (
                      <form
                        onSubmit={(event) => void updateSearchTitle(event)}
                        className="mt-2 flex max-w-2xl items-center gap-2"
                      >
                        <input
                          autoFocus
                          value={editedSearchTitle}
                          aria-label="検索用タイトル"
                          onChange={(event) =>
                            setEditedSearchTitle(event.target.value)
                          }
                          className="h-9 min-w-0 flex-1 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
                        />
                        <button
                          type="submit"
                          title="タイトルを編集"
                          disabled={
                            isUpdatingSearchTitle ||
                            !editedSearchTitle.trim() ||
                            editedSearchTitle.trim() ===
                              currentSeries.searchTitle
                          }
                          className="flex size-9 items-center justify-center rounded-md bg-cyan-700 text-white hover:bg-cyan-800 disabled:opacity-40"
                        >
                          {isUpdatingSearchTitle ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Check className="size-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          title="キャンセル"
                          disabled={isUpdatingSearchTitle}
                          onClick={() => {
                            setEditedSearchTitle(currentSeries.searchTitle);
                            setIsEditingSearchTitle(false);
                          }}
                          className="flex size-9 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                        >
                          <X className="size-4" />
                        </button>
                      </form>
                    ) : (
                      <div className="mt-1 flex items-center gap-2">
                        <p className="text-xs text-stone-500">
                          検索用タイトル: {currentSeries.searchTitle}
                        </p>
                        <button
                          type="button"
                          title="タイトルを編集"
                          onClick={() => {
                            setEditedSearchTitle(currentSeries.searchTitle);
                            setIsEditingSearchTitle(true);
                          }}
                          className="flex size-7 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-cyan-800">
                      {items.length}冊
                    </span>
                    <button
                      type="button"
                      disabled={isDeletingSeries}
                      onClick={() => void deleteSeries()}
                      className="flex h-8 items-center gap-2 rounded-md border border-red-300 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-40"
                    >
                      {isDeletingSeries ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      シリーズ削除
                    </button>
                  </div>
                </div>
              </div>

              {error ? (
                <p className="mt-4 border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              ) : null}

              {items.length > 0 ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-stone-200 bg-white px-3 py-2">
                  <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
                    <input
                      type="checkbox"
                      checked={areAllVisibleItemsSelected}
                      onChange={toggleVisibleItemsSelection}
                      className="size-4 accent-cyan-700"
                    />
                    表示中を選択
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-stone-500">
                      {selectedVisibleItemIsbns.length}件選択中
                    </span>
                    <select
                      value={bulkMoveCategoryNumber}
                      onChange={(event) =>
                        setBulkMoveCategoryNumber(event.target.value)
                      }
                      disabled={
                        selectedVisibleItemIsbns.length === 0 || isBulkMoving
                      }
                      className="h-8 rounded-md border border-stone-300 bg-white px-2 text-xs font-semibold text-stone-700 disabled:opacity-40"
                    >
                      {categories.map((category) => (
                        <option
                          key={category.categoryNumber}
                          value={category.categoryNumber}
                        >
                          {category.categoryNumber}: {category.categoryName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={
                        selectedVisibleItemIsbns.length === 0 ||
                        isBulkMoving ||
                        unlinkingIsbn !== null ||
                        isBulkUnlinking
                      }
                      onClick={() => void bulkMoveSelectedItems()}
                      className="flex h-8 items-center gap-2 rounded-md border border-cyan-300 px-3 text-xs font-bold text-cyan-800 hover:bg-cyan-50 disabled:opacity-40"
                    >
                      {isBulkMoving ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <ArrowRight className="size-4" />
                      )}
                      選択を移動
                    </button>
                    <button
                      type="button"
                      disabled={
                        selectedVisibleItemIsbns.length === 0 ||
                        unlinkingIsbn !== null ||
                        isBulkUnlinking ||
                        isBulkMoving
                      }
                      onClick={() => void bulkUnlinkItems()}
                      className="flex h-8 items-center gap-2 rounded-md border border-red-300 px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-40"
                    >
                      {isBulkUnlinking ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Link2Off className="size-4" />
                      )}
                      選択を紐づけ解除
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 space-y-6">
                  <form
                    onSubmit={(event) => void addCategory(event)}
                    className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-stone-300 bg-white px-3 py-3"
                  >
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-stone-500">
                        新規カテゴリ番号
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={newCategoryNumber}
                        onChange={(event) =>
                          setNewCategoryNumber(event.target.value)
                        }
                        className="h-9 w-32 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
                      />
                    </label>
                    <label className="flex min-w-[180px] flex-1 flex-col gap-1">
                      <span className="text-[11px] font-semibold text-stone-500">
                        新規カテゴリ名
                      </span>
                      <input
                        value={newCategoryName}
                        onChange={(event) =>
                          setNewCategoryName(event.target.value)
                        }
                        placeholder="スピンオフ"
                        className="h-9 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={isAddingCategory || !newCategoryName.trim()}
                      className="flex h-9 items-center gap-2 rounded-md bg-stone-900 px-3 text-xs font-bold text-white hover:bg-stone-800 disabled:opacity-40"
                    >
                      {isAddingCategory ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Plus className="size-4" />
                      )}
                      カテゴリ追加
                    </button>
                  </form>

                  {itemGroups.map((group) => {
                    const draft = categoryDrafts[String(group.categoryNumber)] ?? {
                      categoryNumber: String(group.categoryNumber),
                      categoryName: group.categoryName,
                    };

                    return (
                      <section
                        key={group.categoryNumber}
                        className="border-t-2 border-stone-300 pt-3"
                      >
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveCategory(group);
                          }}
                          className="mb-3 flex flex-wrap items-end justify-between gap-3"
                        >
                          <div className="flex flex-wrap items-end gap-2">
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] font-semibold text-stone-500">
                                カテゴリ番号
                              </span>
                              <input
                                type="number"
                                min={0}
                                value={draft.categoryNumber}
                                onChange={(event) =>
                                  updateCategoryDraft(group.categoryNumber, {
                                    categoryNumber: event.target.value,
                                  })
                                }
                                className="h-9 w-28 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
                              />
                            </label>
                            <label className="flex min-w-[180px] flex-1 flex-col gap-1">
                              <span className="text-[11px] font-semibold text-stone-500">
                                カテゴリ名
                              </span>
                              <input
                                value={draft.categoryName}
                                onChange={(event) =>
                                  updateCategoryDraft(group.categoryNumber, {
                                    categoryName: event.target.value,
                                  })
                                }
                                className="h-9 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
                              />
                            </label>
                            <button
                              type="submit"
                              disabled={
                                savingCategoryNumber === group.categoryNumber ||
                                !draft.categoryName.trim()
                              }
                              className="flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-3 text-xs font-bold text-white hover:bg-cyan-800 disabled:opacity-40"
                            >
                              {savingCategoryNumber === group.categoryNumber ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <Check className="size-4" />
                              )}
                              保存
                            </button>
                            <button
                              type="button"
                              title={
                                group.items.length > 0
                                  ? "アイテムが入っているカテゴリは削除できません"
                                  : "カテゴリを削除"
                              }
                              disabled={
                                group.items.length > 0 ||
                                deletingCategoryNumber === group.categoryNumber
                              }
                              onClick={() => void deleteCategory(group)}
                              className="flex h-9 items-center gap-2 rounded-md border border-red-300 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-40"
                            >
                              {deletingCategoryNumber === group.categoryNumber ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <Trash2 className="size-4" />
                              )}
                              削除
                            </button>
                          </div>
                          <span className="text-xs font-bold text-stone-500">
                            {group.items.length}冊
                          </span>
                        </form>

                        {group.items.length === 0 ? (
                          <div className="rounded-md border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-500">
                            このカテゴリにはアイテムがありません
                          </div>
                        ) : (
                          <div className="grid gap-3 md:grid-cols-2">
                            {group.items.map((item) => (
                              <article
                                key={item.isbn}
                                className="grid min-w-0 grid-cols-[76px_minmax(0,1fr)] gap-3 rounded-md border border-stone-200 bg-white p-3"
                              >
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
                                  <div className="flex items-start justify-between gap-2">
                                    <h3 className="min-w-0 text-sm font-bold leading-5 text-stone-900">
                                      {item.title}
                                    </h3>
                                    <input
                                      type="checkbox"
                                      checked={selectedItemIsbns.has(item.isbn)}
                                      onChange={() => toggleItemSelection(item.isbn)}
                                      aria-label={`${item.isbn}を選択`}
                                      className="mt-0.5 size-4 shrink-0 accent-cyan-700"
                                    />
                                  </div>
                                  <p className="mt-1 text-xs text-stone-500">
                                    {item.author || "著者未設定"}
                                  </p>
                                  <p className="mt-1 font-mono text-[11px] text-stone-400">
                                    {item.isbn}
                                  </p>
                                  {item.normalizedTitle ? (
                                    <p className="mt-1 break-all font-mono text-[11px] text-cyan-800">
                                      {item.normalizedTitle}
                                    </p>
                                  ) : null}
                                  <p className="mt-1 text-[11px] text-stone-400">
                                    {item.matchMethod} / {item.salesDate || "発売日未設定"}
                                  </p>
                                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                                    <select
                                      value={item.categoryNumber}
                                      disabled={movingItemIsbn === item.isbn}
                                      onChange={(event) =>
                                        void moveItemToCategory(
                                          item,
                                          Number(event.target.value),
                                        )
                                      }
                                      className="h-8 min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 text-xs font-semibold text-stone-700 disabled:opacity-40"
                                    >
                                      {categories.map((category) => (
                                        <option
                                          key={category.categoryNumber}
                                          value={category.categoryNumber}
                                        >
                                          {category.categoryNumber}: {category.categoryName}
                                        </option>
                                      ))}
                                    </select>
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
                                      disabled={
                                        unlinkingIsbn !== null ||
                                        isBulkUnlinking ||
                                        movingItemIsbn === item.isbn
                                      }
                                      onClick={() => void unlinkItem(item)}
                                      className="flex h-8 flex-1 items-center justify-center gap-2 rounded-md border border-red-300 px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-40"
                                    >
                                      {unlinkingIsbn === item.isbn ||
                                      movingItemIsbn === item.isbn ? (
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
                      </section>
                    );
                  })}
                {items.length === 0 ? (
                  <div className="rounded-md border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-500">
                    このシリーズに紐づくアイテムはありません
                  </div>
                ) : null}
              </div>
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
