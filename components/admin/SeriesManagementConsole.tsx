"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  ArrowUp,
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
  UserRound,
  X,
} from "lucide-react";
import type {
  ManagedAgent,
  ManagedGenre,
  ManagedMangaSeries,
  ManagedPublisher,
  ManagedSeriesAgent,
  ManagedSeriesCategory,
  ManagedSeriesGenre,
  ManagedSeriesItem,
  ManagedSeriesPublisher,
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
  genres: ManagedSeriesGenre[];
  publishers: ManagedSeriesPublisher[];
  agents: ManagedSeriesAgent[];
  items: ManagedSeriesItem[];
};

type BulkUnlinkResponse = {
  unlinkedCount?: number;
  missingIsbns?: string[];
};

type AgentsResponse = {
  agents: ManagedAgent[];
  page: number;
  pageSize: number;
  total: number;
};

type GenresResponse = {
  genres: ManagedGenre[];
  page: number;
  pageSize: number;
  total: number;
};

type PublishersResponse = {
  publishers: ManagedPublisher[];
  page: number;
  pageSize: number;
  total: number;
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
  const [genres, setGenres] = useState<ManagedSeriesGenre[]>([]);
  const [publishers, setPublishers] = useState<ManagedSeriesPublisher[]>([]);
  const [agents, setAgents] = useState<ManagedSeriesAgent[]>([]);
  const [items, setItems] = useState<ManagedSeriesItem[]>([]);
  const [queryText, setQueryText] = useState(initialQuery);
  const [excludeEmptySeries, setExcludeEmptySeries] = useState(false);
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
  const [agentSearchText, setAgentSearchText] = useState("");
  const [agentSearchResults, setAgentSearchResults] = useState<ManagedAgent[]>(
    [],
  );
  const [isSearchingAgents, setIsSearchingAgents] = useState(false);
  const [isAddingAgent, setIsAddingAgent] = useState(false);
  const [updatingAgentId, setUpdatingAgentId] = useState<string | null>(null);
  const [reorderingItemIsbn, setReorderingItemIsbn] = useState<string | null>(
    null,
  );
  const [genreSearchText, setGenreSearchText] = useState("");
  const [genreSearchResults, setGenreSearchResults] = useState<ManagedGenre[]>(
    [],
  );
  const [isSearchingGenres, setIsSearchingGenres] = useState(false);
  const [isAddingGenre, setIsAddingGenre] = useState(false);
  const [deletingGenreId, setDeletingGenreId] = useState<string | null>(
    null,
  );
  const [newGenreName, setNewGenreName] = useState("");
  const [publisherSearchText, setPublisherSearchText] = useState("");
  const [publisherSearchResults, setPublisherSearchResults] = useState<
    ManagedPublisher[]
  >([]);
  const [isSearchingPublishers, setIsSearchingPublishers] = useState(false);
  const [isAddingPublisher, setIsAddingPublisher] = useState(false);
  const [deletingPublisherId, setDeletingPublisherId] = useState<string | null>(
    null,
  );
  const [newImprintName, setNewImprintName] = useState("");
  const [newPublisherName, setNewPublisherName] = useState("");
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
          left.displayOrder - right.displayOrder ||
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

    if (excludeEmptySeries) {
      params.set("excludeEmpty", "true");
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
    excludeEmptySeries,
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
        setGenres([]);
        setPublishers([]);
        setAgents([]);
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
      setGenres(data.genres);
      setPublishers(data.publishers);
      setAgents(data.agents);
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
      setGenreSearchText("");
      setGenreSearchResults([]);
      setNewGenreName("");
      setPublisherSearchText("");
      setPublisherSearchResults([]);
      setNewImprintName("");
      setNewPublisherName("");
      setAgentSearchText("");
      setAgentSearchResults([]);
      setIsEditingTitle(false);
      setIsEditingSearchTitle(false);
      setItems(data.items);
      setSelectedItemIsbns(new Set());
      setIsDetailLoading(false);
    },
    [accessToken, authorizedFetch, handleUnauthorized],
  );

  const searchAgents = useCallback(
    async (query: string) => {
      if (!accessToken || query.trim().length < 1) {
        setAgentSearchResults([]);
        return;
      }

      setIsSearchingAgents(true);
      const params = new URLSearchParams({
        q: query.trim(),
        pageSize: "8",
      });
      const response = await authorizedFetch(`/api/admin/agents?${params}`);

      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }

      if (!response.ok) {
        setError("作者検索に失敗しました。");
        setIsSearchingAgents(false);
        return;
      }

      const data = (await response.json()) as AgentsResponse;
      setAgentSearchResults(data.agents);
      setIsSearchingAgents(false);
    },
    [accessToken, authorizedFetch, handleUnauthorized],
  );

  const searchGenres = useCallback(
    async (query: string) => {
      if (!accessToken || query.trim().length < 1) {
        setGenreSearchResults([]);
        return;
      }

      setIsSearchingGenres(true);
      const params = new URLSearchParams({
        q: query.trim(),
        pageSize: "8",
      });
      const response = await authorizedFetch(`/api/admin/genres?${params}`);

      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }

      if (!response.ok) {
        setError("ジャンル検索に失敗しました。");
        setIsSearchingGenres(false);
        return;
      }

      const data = (await response.json()) as GenresResponse;
      setGenreSearchResults(data.genres);
      setIsSearchingGenres(false);
    },
    [accessToken, authorizedFetch, handleUnauthorized],
  );

  const searchPublishers = useCallback(
    async (query: string) => {
      if (!accessToken || query.trim().length < 1) {
        setPublisherSearchResults([]);
        return;
      }

      setIsSearchingPublishers(true);
      const params = new URLSearchParams({
        q: query.trim(),
        pageSize: "8",
      });
      const response = await authorizedFetch(`/api/admin/publishers?${params}`);

      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }

      if (!response.ok) {
        setError("出版社・掲載誌検索に失敗しました。");
        setIsSearchingPublishers(false);
        return;
      }

      const data = (await response.json()) as PublishersResponse;
      setPublisherSearchResults(data.publishers);
      setIsSearchingPublishers(false);
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
  }, [excludeEmptySeries, page, queryText]);

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

  useEffect(() => {
    const timeout = window.setTimeout(
      () => void searchAgents(agentSearchText),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [agentSearchText, searchAgents]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => void searchGenres(genreSearchText),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [genreSearchText, searchGenres]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => void searchPublishers(publisherSearchText),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [publisherSearchText, searchPublishers]);

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

  async function addAgent(agent: ManagedAgent) {
    if (!selectedSeriesId) {
      return;
    }

    setIsAddingAgent(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/agents`,
      {
        method: "POST",
        body: JSON.stringify({ agentId: agent.id }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError(
        response.status === 404
          ? "作者が見つかりませんでした。"
          : "作者を追加できませんでした。",
      );
      setIsAddingAgent(false);
      return;
    }

    await loadSeriesDetail(selectedSeriesId);
    setAgentSearchText("");
    setAgentSearchResults([]);
    setIsAddingAgent(false);
  }

  async function deleteAgent(agent: ManagedSeriesAgent) {
    if (!selectedSeriesId) {
      return;
    }

    const confirmed = window.confirm(
      `作者「${agent.agentName}」をこのシリーズから削除しますか？`,
    );

    if (!confirmed) {
      return;
    }

    setUpdatingAgentId(agent.agentId);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/agents/${encodeURIComponent(agent.agentId)}`,
      { method: "DELETE" },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("作者を削除できませんでした。");
      setUpdatingAgentId(null);
      return;
    }

    await loadSeriesDetail(selectedSeriesId);
    setUpdatingAgentId(null);
  }

  async function moveAgent(agent: ManagedSeriesAgent, direction: -1 | 1) {
    if (!selectedSeriesId) {
      return;
    }

    const currentIndex = agents.findIndex(
      (entry) => entry.agentId === agent.agentId,
    );
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= agents.length) {
      return;
    }

    const nextAgents = [...agents];
    const [movedAgent] = nextAgents.splice(currentIndex, 1);
    nextAgents.splice(nextIndex, 0, movedAgent);
    const agentOrders = nextAgents.map((entry, index) => ({
      agentId: entry.agentId,
      sortOrder: index,
    }));

    setAgents(
      nextAgents.map((entry, index) => ({
        ...entry,
        sortOrder: index,
      })),
    );
    setUpdatingAgentId(agent.agentId);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/agents`,
      {
        method: "PATCH",
        body: JSON.stringify({ agents: agentOrders }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("作者の表示順を変更できませんでした。");
      await loadSeriesDetail(selectedSeriesId);
      setUpdatingAgentId(null);
      return;
    }

    setUpdatingAgentId(null);
  }

  async function addGenre(genre: ManagedGenre) {
    if (!selectedSeriesId) {
      return;
    }

    setIsAddingGenre(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/genres`,
      {
        method: "POST",
        body: JSON.stringify({ genreId: genre.genreId }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError(
        response.status === 409
          ? "同じジャンルが既に追加されています。"
          : "ジャンルを追加できませんでした。",
      );
      setIsAddingGenre(false);
      return;
    }

    await loadSeriesDetail(selectedSeriesId);
    setGenreSearchText("");
    setGenreSearchResults([]);
    setIsAddingGenre(false);
  }

  async function createAndAddGenre() {
    if (!selectedSeriesId) {
      return;
    }

    const genreName = newGenreName.trim();

    if (!genreName) {
      setError("ジャンル名を入力してください。");
      return;
    }

    setIsAddingGenre(true);
    setError("");
    const createResponse = await authorizedFetch("/api/admin/genres", {
      method: "POST",
      body: JSON.stringify({ genreName }),
    });

    if (createResponse.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!createResponse.ok && createResponse.status !== 409) {
      setError("ジャンルを作成できませんでした。");
      setIsAddingGenre(false);
      return;
    }

    let genre: ManagedGenre | undefined;

    if (createResponse.ok) {
      const data = (await createResponse.json()) as { genre: ManagedGenre };
      genre = data.genre;
    } else {
      const params = new URLSearchParams({
        q: genreName,
        pageSize: "20",
      });
      const searchResponse = await authorizedFetch(`/api/admin/genres?${params}`);

      if (!searchResponse.ok) {
        setError("既存のジャンルを取得できませんでした。");
        setIsAddingGenre(false);
        return;
      }

      const data = (await searchResponse.json()) as GenresResponse;
      genre = data.genres.find((entry) => entry.genreName === genreName);
    }

    if (!genre) {
      setError("追加するジャンルを特定できませんでした。");
      setIsAddingGenre(false);
      return;
    }

    await addGenre(genre);
    setNewGenreName("");
  }

  async function deleteGenre(genre: ManagedSeriesGenre) {
    if (!selectedSeriesId) {
      return;
    }

    const genreLabel = genre.genreName ?? genre.genreId;
    const confirmed = window.confirm(
      `ジャンル「${genreLabel}」を削除しますか？`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingGenreId(genre.genreId);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/genres/${encodeURIComponent(genre.genreId)}`,
      { method: "DELETE" },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("ジャンルを削除できませんでした。");
      setDeletingGenreId(null);
      return;
    }

    await loadSeriesDetail(selectedSeriesId);
    setDeletingGenreId(null);
  }

  async function addPublisher(publisher: ManagedPublisher) {
    if (!selectedSeriesId) {
      return;
    }

    setIsAddingPublisher(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/publishers`,
      {
        method: "POST",
        body: JSON.stringify({ publisherId: publisher.publisherId }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError(
        response.status === 409
          ? "同じ出版社・掲載誌が既に追加されています。"
          : "出版社・掲載誌を追加できませんでした。",
      );
      setIsAddingPublisher(false);
      return;
    }

    await loadSeriesDetail(selectedSeriesId);
    setPublisherSearchText("");
    setPublisherSearchResults([]);
    setIsAddingPublisher(false);
  }

  async function createAndAddPublisher() {
    if (!selectedSeriesId) {
      return;
    }

    const imprintName = newImprintName.trim();
    const publisherName = newPublisherName.trim();

    if (!imprintName || !publisherName) {
      setError("掲載誌・レーベル名と出版社名を入力してください。");
      return;
    }

    setIsAddingPublisher(true);
    setError("");
    const createResponse = await authorizedFetch("/api/admin/publishers", {
      method: "POST",
      body: JSON.stringify({ imprintName, publisherName }),
    });

    if (createResponse.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!createResponse.ok && createResponse.status !== 409) {
      setError("出版社・掲載誌を作成できませんでした。");
      setIsAddingPublisher(false);
      return;
    }

    let publisher: ManagedPublisher | undefined;

    if (createResponse.ok) {
      const data = (await createResponse.json()) as {
        publisher: ManagedPublisher;
      };
      publisher = data.publisher;
    } else {
      const params = new URLSearchParams({
        q: `${publisherName} ${imprintName}`,
        pageSize: "20",
      });
      const searchResponse = await authorizedFetch(
        `/api/admin/publishers?${params}`,
      );

      if (!searchResponse.ok) {
        setError("既存の出版社・掲載誌を取得できませんでした。");
        setIsAddingPublisher(false);
        return;
      }

      const data = (await searchResponse.json()) as PublishersResponse;
      publisher = data.publishers.find(
        (entry) =>
          entry.imprintName === imprintName &&
          entry.publisherName === publisherName,
      );
    }

    if (!publisher) {
      setError("追加する出版社・掲載誌を特定できませんでした。");
      setIsAddingPublisher(false);
      return;
    }

    await addPublisher(publisher);
    setNewImprintName("");
    setNewPublisherName("");
  }

  async function deletePublisher(publisher: ManagedSeriesPublisher) {
    if (!selectedSeriesId) {
      return;
    }

    const confirmed = window.confirm(
      `「${publisher.publisherName} / ${publisher.imprintName}」をこのシリーズから削除しますか？`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingPublisherId(publisher.publisherId);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/publishers/${encodeURIComponent(
        publisher.publisherId,
      )}`,
      { method: "DELETE" },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("出版社・掲載誌を削除できませんでした。");
      setDeletingPublisherId(null);
      return;
    }

    await loadSeriesDetail(selectedSeriesId);
    setDeletingPublisherId(null);
  }

  async function moveItemDisplayOrder(
    groupItems: ManagedSeriesItem[],
    item: ManagedSeriesItem,
    direction: -1 | 1,
  ) {
    if (!selectedSeriesId) {
      return;
    }

    const currentIndex = groupItems.findIndex(
      (entry) => entry.isbn === item.isbn,
    );
    const nextIndex = currentIndex + direction;

    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= groupItems.length) {
      return;
    }

    const nextItems = [...groupItems];
    const [movedItem] = nextItems.splice(currentIndex, 1);
    nextItems.splice(nextIndex, 0, movedItem);
    const itemOrders = nextItems.map((entry, index) => ({
      isbn: entry.isbn,
      categoryNumber: entry.categoryNumber,
      displayOrder: index,
    }));

    setReorderingItemIsbn(item.isbn);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/series/${selectedSeriesId}/items`,
      {
        method: "PATCH",
        body: JSON.stringify({ itemOrders }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("アイテムの表示順を変更できませんでした。");
      setReorderingItemIsbn(null);
      return;
    }

    await loadSeriesDetail(selectedSeriesId);
    setReorderingItemIsbn(null);
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
            <Link
              href="/admin/agents"
              className="flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100"
            >
              <UserRound className="size-4" />
              作者管理
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
            <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-stone-700">
              <input
                type="checkbox"
                checked={excludeEmptySeries}
                onChange={(event) => {
                  setPage(1);
                  setExcludeEmptySeries(event.target.checked);
                }}
                className="size-4 accent-cyan-700"
              />
              アイテム未紐づきのシリーズを除外
            </label>
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

              <section className="mt-4 rounded-md border border-stone-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-stone-900">
                    作者
                  </h3>
                  <span className="text-xs font-semibold text-stone-500">
                    {agents.length}人
                  </span>
                </div>
                <div className="mt-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-stone-500">
                      追加する作者名で検索
                    </span>
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 size-4 text-stone-400" />
                      <input
                        value={agentSearchText}
                        onChange={(event) =>
                          setAgentSearchText(event.target.value)
                        }
                        placeholder="作者名で検索"
                        className="h-9 w-full rounded-md border border-stone-300 pl-9 pr-3 text-sm outline-none focus:border-cyan-700"
                      />
                    </div>
                  </label>
                  {isSearchingAgents ? (
                    <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-stone-500">
                      <LoaderCircle className="size-4 animate-spin" />
                      検索中...
                    </p>
                  ) : null}
                  {agentSearchText.trim() && agentSearchResults.length === 0 && !isSearchingAgents ? (
                    <p className="mt-2 rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-500">
                      一致する作者が見つかりません。必要なら作者編集画面で新規追加してください。
                    </p>
                  ) : null}
                  {agentSearchResults.length > 0 ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {agentSearchResults.map((agent) => {
                        const isLinked = agents.some(
                          (entry) => entry.agentId === agent.id,
                        );

                        return (
                          <div
                            key={agent.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-stone-900">
                                {agent.name}
                              </p>
                              {agent.authorWikiLink ? (
                                <p className="truncate text-[11px] text-stone-500">
                                  {agent.authorWikiLink}
                                </p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              disabled={isAddingAgent || isLinked}
                              onClick={() => void addAgent(agent)}
                              className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-stone-900 px-3 text-xs font-bold text-white hover:bg-stone-800 disabled:opacity-40"
                            >
                              {isAddingAgent ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <Plus className="size-4" />
                              )}
                              {isLinked ? "追加済み" : "追加"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                {agents.length === 0 ? (
                  <p className="mt-3 rounded-md bg-stone-50 px-3 py-4 text-center text-sm text-stone-500">
                    このシリーズには作者が紐づいていません
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {agents.map((agent, index) => (
                      <div
                        key={agent.agentId}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-stone-200 bg-stone-50 p-2"
                      >
                        <span className="w-8 text-center text-xs font-bold text-stone-500">
                          {index + 1}
                        </span>
                        <div className="min-w-[180px] flex-1">
                          <p className="text-sm font-bold text-stone-900">
                            {agent.agentName}
                          </p>
                          {agent.authorWikiLink ? (
                            <p className="mt-1 break-all text-[11px] text-stone-500">
                              {agent.authorWikiLink}
                            </p>
                          ) : (
                            <p className="mt-1 text-[11px] text-stone-400">
                              Wiki URL未設定
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          title="上へ"
                          disabled={index === 0 || updatingAgentId !== null}
                          onClick={() => void moveAgent(agent, -1)}
                          className="flex size-8 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                        >
                          <ArrowUp className="size-4" />
                        </button>
                        <button
                          type="button"
                          title="下へ"
                          disabled={
                            index === agents.length - 1 ||
                            updatingAgentId !== null
                          }
                          onClick={() => void moveAgent(agent, 1)}
                          className="flex size-8 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                        >
                          <ArrowDown className="size-4" />
                        </button>
                        <button
                          type="button"
                          disabled={updatingAgentId !== null}
                          onClick={() => void deleteAgent(agent)}
                          className="flex h-8 items-center gap-2 rounded-md border border-red-300 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-40"
                        >
                          <Trash2 className="size-4" />
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="mt-4 rounded-md border border-stone-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-stone-900">
                    出版社・掲載誌
                  </h3>
                  <span className="text-xs font-semibold text-stone-500">
                    {publishers.length}件
                  </span>
                </div>
                <div className="mt-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-stone-500">
                      追加する出版社名または掲載誌名で検索
                    </span>
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 size-4 text-stone-400" />
                      <input
                        value={publisherSearchText}
                        onChange={(event) =>
                          setPublisherSearchText(event.target.value)
                        }
                        placeholder="出版社名・掲載誌名で検索"
                        className="h-9 w-full rounded-md border border-stone-300 pl-9 pr-3 text-sm outline-none focus:border-cyan-700"
                      />
                    </div>
                  </label>
                  {isSearchingPublishers ? (
                    <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-stone-500">
                      <LoaderCircle className="size-4 animate-spin" />
                      検索中...
                    </p>
                  ) : null}
                  {publisherSearchText.trim() &&
                  publisherSearchResults.length === 0 &&
                  !isSearchingPublishers ? (
                    <p className="mt-2 rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-500">
                      一致する出版社・掲載誌が見つかりません。下の入力欄から新規追加できます。
                    </p>
                  ) : null}
                  {publisherSearchResults.length > 0 ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {publisherSearchResults.map((publisher) => {
                        const isLinked = publishers.some(
                          (entry) =>
                            entry.publisherId === publisher.publisherId,
                        );

                        return (
                          <div
                            key={publisher.publisherId}
                            className="flex items-center justify-between gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-stone-900">
                                {publisher.imprintName}
                              </p>
                              <p className="truncate text-[11px] text-stone-500">
                                出版社: {publisher.publisherName}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={isAddingPublisher || isLinked}
                              onClick={() => void addPublisher(publisher)}
                              className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-stone-900 px-3 text-xs font-bold text-white hover:bg-stone-800 disabled:opacity-40"
                            >
                              {isAddingPublisher ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <Plus className="size-4" />
                              )}
                              {isLinked ? "追加済み" : "追加"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <form
                  className="mt-3 grid gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 sm:grid-cols-[1fr_1fr_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createAndAddPublisher();
                  }}
                >
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-stone-500">
                      掲載誌・レーベル
                    </span>
                    <input
                      value={newImprintName}
                      onChange={(event) => setNewImprintName(event.target.value)}
                      placeholder="週刊少年ジャンプ"
                      className="h-9 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-stone-500">
                      出版社
                    </span>
                    <input
                      value={newPublisherName}
                      onChange={(event) =>
                        setNewPublisherName(event.target.value)
                      }
                      placeholder="集英社"
                      className="h-9 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isAddingPublisher}
                    className="flex h-9 items-center justify-center gap-2 self-end rounded-md bg-cyan-700 px-4 text-xs font-bold text-white hover:bg-cyan-800 disabled:opacity-40"
                  >
                    {isAddingPublisher ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    新規追加
                  </button>
                </form>
                {publishers.length === 0 ? (
                  <p className="mt-3 rounded-md bg-stone-50 px-3 py-4 text-center text-sm text-stone-500">
                    このシリーズには出版社・掲載誌が設定されていません
                  </p>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {publishers.map((publisher) => (
                      <div
                        key={publisher.publisherId}
                        className="flex items-center justify-between gap-2 rounded-md border border-stone-200 bg-stone-50 p-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-stone-900">
                            {publisher.imprintName}
                          </p>
                          <p className="truncate text-[11px] text-stone-500">
                            出版社: {publisher.publisherName}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={deletingPublisherId !== null}
                          onClick={() => void deletePublisher(publisher)}
                          className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-red-300 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-40"
                        >
                          {deletingPublisherId === publisher.publisherId ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                          削除
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="mt-4 rounded-md border border-stone-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-stone-900">
                    ジャンル
                  </h3>
                  <span className="text-xs font-semibold text-stone-500">
                    {genres.length}件
                  </span>
                </div>
                <div className="mt-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-stone-500">
                      追加するジャンル名で検索
                    </span>
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 size-4 text-stone-400" />
                      <input
                        value={genreSearchText}
                        onChange={(event) =>
                          setGenreSearchText(event.target.value)
                        }
                        placeholder="ジャンル名で検索"
                        className="h-9 w-full rounded-md border border-stone-300 pl-9 pr-3 text-sm outline-none focus:border-cyan-700"
                      />
                    </div>
                  </label>
                  {isSearchingGenres ? (
                    <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-stone-500">
                      <LoaderCircle className="size-4 animate-spin" />
                      検索中...
                    </p>
                  ) : null}
                  {genreSearchText.trim() &&
                  genreSearchResults.length === 0 &&
                  !isSearchingGenres ? (
                    <p className="mt-2 rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-500">
                      一致するジャンルが見つかりません。
                    </p>
                  ) : null}
                  {genreSearchResults.length > 0 ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {genreSearchResults.map((genre) => {
                        const isLinked = genres.some(
                          (entry) => entry.genreId === genre.genreId,
                        );

                        return (
                          <div
                            key={genre.genreId}
                            className="flex items-center justify-between gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-stone-900">
                                {genre.genreName}
                              </p>
                              <p className="truncate font-mono text-[11px] text-stone-500">
                                {genre.genreId}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={isAddingGenre || isLinked}
                              onClick={() => void addGenre(genre)}
                              className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-stone-900 px-3 text-xs font-bold text-white hover:bg-stone-800 disabled:opacity-40"
                            >
                              {isAddingGenre ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <Plus className="size-4" />
                              )}
                              {isLinked ? "追加済み" : "追加"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <form
                  className="mt-3 grid gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 sm:grid-cols-[1fr_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createAndAddGenre();
                  }}
                >
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-stone-500">
                      新規ジャンル名
                    </span>
                    <input
                      value={newGenreName}
                      onChange={(event) => setNewGenreName(event.target.value)}
                      placeholder="アクション"
                      className="h-9 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isAddingGenre}
                    className="flex h-9 items-center justify-center gap-2 self-end rounded-md bg-cyan-700 px-4 text-xs font-bold text-white hover:bg-cyan-800 disabled:opacity-40"
                  >
                    {isAddingGenre ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    新規追加
                  </button>
                </form>
                {genres.length === 0 ? (
                  <p className="mt-3 rounded-md bg-stone-50 px-3 py-4 text-center text-sm text-stone-500">
                    このシリーズにはジャンルが設定されていません
                  </p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {genres.map((genre) => (
                      <span
                        key={genre.genreId}
                        className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-sm font-semibold text-stone-700"
                      >
                        {genre.genreName ?? genre.genreId}
                        <button
                          type="button"
                          disabled={deletingGenreId !== null}
                          onClick={() => void deleteGenre(genre)}
                          className="rounded-full text-red-600 hover:text-red-800 disabled:opacity-40"
                          aria-label={`${genre.genreName ?? genre.genreId}を削除`}
                        >
                          {deletingGenreId === genre.genreId ? (
                            <LoaderCircle className="size-3 animate-spin" />
                          ) : (
                            <X className="size-3" />
                          )}
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </section>

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
                            {group.items.map((item, itemIndex) => (
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
                                    表示順 {item.displayOrder} /{" "}
                                    {item.matchMethod} /{" "}
                                    {item.salesDate || "発売日未設定"}
                                  </p>
                                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                                    <button
                                      type="button"
                                      title="表示順を上へ"
                                      disabled={
                                        itemIndex === 0 ||
                                        reorderingItemIsbn !== null
                                      }
                                      onClick={() =>
                                        void moveItemDisplayOrder(
                                          group.items,
                                          item,
                                          -1,
                                        )
                                      }
                                      className="flex size-8 items-center justify-center rounded-md border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                                    >
                                      {reorderingItemIsbn === item.isbn ? (
                                        <LoaderCircle className="size-4 animate-spin" />
                                      ) : (
                                        <ArrowUp className="size-4" />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      title="表示順を下へ"
                                      disabled={
                                        itemIndex === group.items.length - 1 ||
                                        reorderingItemIsbn !== null
                                      }
                                      onClick={() =>
                                        void moveItemDisplayOrder(
                                          group.items,
                                          item,
                                          1,
                                        )
                                      }
                                      className="flex size-8 items-center justify-center rounded-md border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-40"
                                    >
                                      {reorderingItemIsbn === item.isbn ? (
                                        <LoaderCircle className="size-4 animate-spin" />
                                      ) : (
                                        <ArrowDown className="size-4" />
                                      )}
                                    </button>
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
