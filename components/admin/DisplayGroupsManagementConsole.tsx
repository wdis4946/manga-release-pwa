"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ImagePlus,
  Link2,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type DisplayGroup = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  seriesCount: number;
};

type LinkedSeries = {
  id: string;
  displayTitle: string;
  searchTitle: string;
  representativeImageUrl: string | null;
  sortOrder: number;
};

type SeriesSearchResult = {
  id: string;
  displayTitle: string;
  searchTitle: string;
  representativeImageUrl: string | null;
};

type DisplayGroupsResponse = {
  displayGroups: DisplayGroup[];
};

type DisplayGroupDetailResponse = {
  displayGroup: DisplayGroup;
  series: LinkedSeries[];
};

type SeriesSearchResponse = {
  series: SeriesSearchResult[];
};

type SeriesSearchMode = "keyword" | "author" | "publisher";

type GroupFormState = {
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
};

const emptyForm: GroupFormState = {
  name: "",
  description: "",
  sortOrder: "0",
  isActive: true,
};

function toFormState(group: DisplayGroup): GroupFormState {
  return {
    name: group.name,
    description: group.description ?? "",
    sortOrder: String(group.sortOrder),
    isActive: group.isActive,
  };
}

function toRequestBody(form: GroupFormState) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    sortOrder: Number.parseInt(form.sortOrder || "0", 10),
    isActive: form.isActive,
  };
}

export function DisplayGroupsManagementConsole() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [groups, setGroups] = useState<DisplayGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [linkedSeries, setLinkedSeries] = useState<LinkedSeries[]>([]);
  const [newForm, setNewForm] = useState<GroupFormState>(emptyForm);
  const [editForm, setEditForm] = useState<GroupFormState>(emptyForm);
  const [seriesQuery, setSeriesQuery] = useState("");
  const [seriesSearchMode, setSeriesSearchMode] =
    useState<SeriesSearchMode>("keyword");
  const [seriesResults, setSeriesResults] = useState<SeriesSearchResult[]>([]);
  const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLinkingSeries, setIsLinkingSeries] = useState(false);
  const [isSavingSeriesOrder, setIsSavingSeriesOrder] = useState(false);
  const [isSeriesOrderDirty, setIsSeriesOrderDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );

  const linkedSeriesIds = useMemo(
    () => new Set(linkedSeries.map((series) => series.id)),
    [linkedSeries],
  );

  const selectableSeriesResults = useMemo(
    () => seriesResults.filter((series) => !linkedSeriesIds.has(series.id)),
    [linkedSeriesIds, seriesResults],
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

  const loadGroups = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setIsLoadingGroups(true);
    setError("");
    const response = await authorizedFetch("/api/admin/display-groups");

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("表示グループを取得できませんでした。");
      setIsLoadingGroups(false);
      return;
    }

    const data = (await response.json()) as DisplayGroupsResponse;
    setGroups(data.displayGroups);
    setSelectedGroupId((current) =>
      data.displayGroups.some((group) => group.id === current)
        ? current
        : (data.displayGroups[0]?.id ?? ""),
    );
    setIsLoadingGroups(false);
  }, [accessToken, authorizedFetch, handleUnauthorized]);

  const loadGroupDetail = useCallback(
    async (groupId: string) => {
      if (!accessToken || !groupId) {
        setLinkedSeries([]);
        setIsSeriesOrderDirty(false);
        setEditForm(emptyForm);
        return;
      }

      setIsLoadingDetail(true);
      setError("");
      const response = await authorizedFetch(`/api/admin/display-groups/${groupId}`);

      if (response.status === 401) {
        await handleUnauthorized();
        return;
      }

      if (!response.ok) {
        setError("表示グループの詳細を取得できませんでした。");
        setIsLoadingDetail(false);
        return;
      }

      const data = (await response.json()) as DisplayGroupDetailResponse;
      setEditForm(toFormState(data.displayGroup));
      setLinkedSeries(data.series);
      setIsSeriesOrderDirty(false);
      setIsLoadingDetail(false);
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
    const timeout = window.setTimeout(() => void loadGroups(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadGroups]);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => void loadGroupDetail(selectedGroupId),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [loadGroupDetail, selectedGroupId]);

  async function createGroup(event: React.FormEvent) {
    event.preventDefault();

    if (!newForm.name.trim()) {
      return;
    }

    setIsSaving(true);
    setError("");
    const response = await authorizedFetch("/api/admin/display-groups", {
      method: "POST",
      body: JSON.stringify(toRequestBody(newForm)),
    });

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("表示グループを作成できませんでした。");
      setIsSaving(false);
      return;
    }

    const data = (await response.json()) as { displayGroup: DisplayGroup };
    setNewForm(emptyForm);
    setSelectedGroupId(data.displayGroup.id);
    await loadGroups();
    setIsSaving(false);
  }

  async function saveGroup(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedGroup || !editForm.name.trim()) {
      return;
    }

    setIsSaving(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/display-groups/${selectedGroup.id}`,
      {
        method: "PATCH",
        body: JSON.stringify(toRequestBody(editForm)),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("表示グループを保存できませんでした。");
      setIsSaving(false);
      return;
    }

    await loadGroups();
    setIsSaving(false);
  }

  async function deleteGroup() {
    if (!selectedGroup) {
      return;
    }

    const confirmed = window.confirm(
      `「${selectedGroup.name}」を削除します。紐づけも削除されます。`,
    );

    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/display-groups/${selectedGroup.id}`,
      { method: "DELETE" },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("表示グループを削除できませんでした。");
      setIsSaving(false);
      return;
    }

    setSelectedGroupId("");
    await loadGroups();
    setIsSaving(false);
  }

  async function searchSeries(event: React.FormEvent) {
    event.preventDefault();

    if (!seriesQuery.trim()) {
      setSeriesResults([]);
      setSelectedResultIds([]);
      return;
    }

    setIsSearching(true);
    setError("");
    const normalizedIsbn = seriesQuery.replace(/\D/g, "");
    const params = new URLSearchParams({
      page: "1",
    });

    if (
      seriesSearchMode === "keyword" &&
      (normalizedIsbn.length === 10 || normalizedIsbn.length === 13)
    ) {
      params.set("isbn", normalizedIsbn);
    } else if (seriesSearchMode === "author") {
      params.set("agent", seriesQuery.trim());
    } else if (seriesSearchMode === "publisher") {
      params.set("publisher", seriesQuery.trim());
    } else {
      params.set("q", seriesQuery.trim());
    }

    const response = await authorizedFetch(`/api/admin/series?${params}`);

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("シリーズ検索に失敗しました。");
      setIsSearching(false);
      return;
    }

    const data = (await response.json()) as SeriesSearchResponse;
    setSeriesResults(data.series);
    setSelectedResultIds([]);
    setIsSearching(false);
  }

  async function linkSeries(seriesId: string) {
    if (!selectedGroup) {
      return;
    }

    setError("");
    const response = await authorizedFetch(
      `/api/admin/display-groups/${selectedGroup.id}/series`,
      {
        method: "POST",
        body: JSON.stringify({ seriesId }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("シリーズを紐づけできませんでした。");
      return;
    }

    await loadGroupDetail(selectedGroup.id);
    await loadGroups();
  }

  async function linkSelectedSeries() {
    if (!selectedGroup) {
      return;
    }

    const targetSeriesIds = [
      ...new Set(
        selectedResultIds.filter((seriesId) => !linkedSeriesIds.has(seriesId)),
      ),
    ];

    if (targetSeriesIds.length === 0) {
      return;
    }

    setIsLinkingSeries(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/display-groups/${selectedGroup.id}/series`,
      {
        method: "POST",
        body: JSON.stringify({ seriesIds: targetSeriesIds }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("シリーズをまとめて紐づけできませんでした。");
      setIsLinkingSeries(false);
      return;
    }

    setSelectedResultIds((current) =>
      current.filter((seriesId) => !targetSeriesIds.includes(seriesId)),
    );
    await loadGroupDetail(selectedGroup.id);
    await loadGroups();
    setIsLinkingSeries(false);
  }

  function toggleResultSelection(seriesId: string) {
    setSelectedResultIds((current) =>
      current.includes(seriesId)
        ? current.filter((selectedId) => selectedId !== seriesId)
        : [...current, seriesId],
    );
  }

  function toggleAllResultSelection() {
    const selectableIds = selectableSeriesResults.map((series) => series.id);

    if (selectableIds.length === 0) {
      return;
    }

    if (selectableIds.every((seriesId) => selectedResultIds.includes(seriesId))) {
      setSelectedResultIds((current) =>
        current.filter((seriesId) => !selectableIds.includes(seriesId)),
      );
      return;
    }

    setSelectedResultIds((current) => [
      ...new Set([...current, ...selectableIds]),
    ]);
  }

  function updateSeriesOrderLocally(seriesId: string, sortOrder: number) {
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      return;
    }

    setLinkedSeries((current) =>
      current
        .map((series) =>
          series.id === seriesId ? { ...series, sortOrder } : series,
        )
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            left.displayTitle.localeCompare(right.displayTitle, "ja") ||
            left.id.localeCompare(right.id),
        ),
    );
    setIsSeriesOrderDirty(true);
  }

  async function saveSeriesOrder() {
    if (!selectedGroup || !isSeriesOrderDirty) {
      return;
    }

    setIsSavingSeriesOrder(true);
    setError("");
    const response = await authorizedFetch(
      `/api/admin/display-groups/${selectedGroup.id}/series`,
      {
        method: "PATCH",
        body: JSON.stringify({
          seriesOrders: linkedSeries.map((series) => ({
            seriesId: series.id,
            sortOrder: series.sortOrder,
          })),
        }),
      },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("並び順を更新できませんでした。");
      setIsSavingSeriesOrder(false);
      return;
    }

    await loadGroupDetail(selectedGroup.id);
    setIsSavingSeriesOrder(false);
  }

  async function unlinkSeries(seriesId: string) {
    if (!selectedGroup) {
      return;
    }

    setError("");
    const response = await authorizedFetch(
      `/api/admin/display-groups/${selectedGroup.id}/series/${seriesId}`,
      { method: "DELETE" },
    );

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError("シリーズの紐づけを解除できませんでした。");
      return;
    }

    await loadGroupDetail(selectedGroup.id);
    await loadGroups();
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
            <h1 className="text-lg font-bold text-stone-950">
              表示グループ管理
            </h1>
            <p className="text-xs text-stone-500">
              公開トップに出す棚を手作業で作成します
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/series"
              className="flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100"
            >
              <ImagePlus className="size-4" />
              シリーズ管理
            </Link>
            <button
              type="button"
              title="再読み込み"
              onClick={() => void loadGroups()}
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
          <form className="border-b border-stone-200 p-3" onSubmit={createGroup}>
            <p className="mb-3 text-sm font-bold text-stone-900">
              新しいグループ
            </p>
            <GroupFields form={newForm} onChange={setNewForm} />
            <button
              type="submit"
              disabled={isSaving || !newForm.name.trim()}
              className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-50"
            >
              <Plus className="size-4" />
              作成
            </button>
          </form>

          <div className="max-h-[60vh] overflow-y-auto xl:max-h-[calc(100vh-387px)]">
            {isLoadingGroups ? (
              <div className="flex h-40 items-center justify-center">
                <LoaderCircle className="size-5 animate-spin text-cyan-700" />
              </div>
            ) : groups.length === 0 ? (
              <p className="p-6 text-center text-sm text-stone-500">
                表示グループがありません
              </p>
            ) : (
              groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`w-full border-b border-stone-100 p-3 text-left ${
                    selectedGroupId === group.id
                      ? "bg-cyan-50"
                      : "hover:bg-stone-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-stone-900">
                      {group.name}
                    </p>
                    <span className="shrink-0 rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-600">
                      {group.seriesCount}件
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">
                    並び順 {group.sortOrder}
                    {group.isActive ? "" : " / 非表示"}
                  </p>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="min-w-0 space-y-4 p-4 sm:p-6 xl:h-[calc(100vh-130px)] xl:overflow-y-auto">
          {error ? (
            <p className="border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {selectedGroup ? (
            <>
              <form
                onSubmit={saveGroup}
                className="rounded-md border border-stone-200 bg-white p-4"
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-stone-950">
                    グループ編集
                  </h2>
                  <button
                    type="button"
                    onClick={() => void deleteGroup()}
                    className="flex h-9 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="size-4" />
                    削除
                  </button>
                </div>
                <GroupFields form={editForm} onChange={setEditForm} />
                <button
                  type="submit"
                  disabled={isSaving || !editForm.name.trim()}
                  className="mt-3 flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-50"
                >
                  <Check className="size-4" />
                  保存
                </button>
              </form>

              <div className="rounded-md border border-stone-200 bg-white p-4">
                <h2 className="text-base font-bold text-stone-950">
                  シリーズを紐づけ
                </h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    ["keyword", "タイトル/ISBN"],
                    ["author", "作者"],
                    ["publisher", "出版社"],
                  ].map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setSeriesSearchMode(mode as SeriesSearchMode);
                        setSeriesResults([]);
                        setSelectedResultIds([]);
                      }}
                      className={`h-8 rounded-md border px-3 text-xs font-semibold ${
                        seriesSearchMode === mode
                          ? "border-cyan-700 bg-cyan-50 text-cyan-800"
                          : "border-stone-300 bg-white text-stone-600 hover:bg-stone-100"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={searchSeries}
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                >
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 size-4 text-stone-400" />
                    <input
                      value={seriesQuery}
                      onChange={(event) => setSeriesQuery(event.target.value)}
                      placeholder={
                        seriesSearchMode === "author"
                          ? "作者名で検索"
                          : seriesSearchMode === "publisher"
                            ? "出版社名で検索"
                            : "ISBNまたはシリーズ名で検索"
                      }
                      className="h-9 w-full rounded-md border border-stone-300 pl-9 pr-3 text-sm outline-none focus:border-cyan-700"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSearching}
                    className="flex h-9 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                  >
                    {isSearching ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Search className="size-4" />
                    )}
                    検索
                  </button>
                </form>

                {seriesResults.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
                      <label className="flex items-center gap-2 text-xs font-semibold text-stone-700">
                        <input
                          type="checkbox"
                          checked={
                            selectableSeriesResults.length > 0 &&
                            selectableSeriesResults.every((series) =>
                              selectedResultIds.includes(series.id),
                            )
                          }
                          onChange={toggleAllResultSelection}
                        />
                        検索結果をすべて選択
                      </label>
                      <button
                        type="button"
                        disabled={
                          isLinkingSeries || selectedResultIds.length === 0
                        }
                        onClick={() => void linkSelectedSeries()}
                        className="flex h-8 items-center gap-2 rounded-md bg-cyan-700 px-3 text-xs font-semibold text-white hover:bg-cyan-800 disabled:opacity-50"
                      >
                        {isLinkingSeries ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Link2 className="size-3.5" />
                        )}
                        選択したシリーズを追加
                      </button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                    {seriesResults.map((series) => (
                      <SeriesSearchCard
                        key={series.id}
                        series={series}
                        disabled={linkedSeriesIds.has(series.id)}
                        selected={selectedResultIds.includes(series.id)}
                        onSelect={() => toggleResultSelection(series.id)}
                        onLink={() => void linkSeries(series.id)}
                      />
                    ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border border-stone-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-stone-950">
                    紐づけ済みシリーズ
                  </h2>
                  <div className="flex items-center gap-2">
                    {isLoadingDetail ? (
                      <LoaderCircle className="size-4 animate-spin text-cyan-700" />
                    ) : null}
                    <button
                      type="button"
                      disabled={
                        !isSeriesOrderDirty ||
                        isSavingSeriesOrder ||
                        linkedSeries.length === 0
                      }
                      onClick={() => void saveSeriesOrder()}
                      className="flex h-8 items-center gap-2 rounded-md bg-cyan-700 px-3 text-xs font-semibold text-white hover:bg-cyan-800 disabled:opacity-50"
                    >
                      {isSavingSeriesOrder ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      並び順を保存
                    </button>
                  </div>
                </div>
                {linkedSeries.length === 0 ? (
                  <p className="py-8 text-center text-sm text-stone-500">
                    まだシリーズが紐づいていません
                  </p>
                ) : (
                  <div className="space-y-2">
                    {linkedSeries.map((series) => (
                      <LinkedSeriesRow
                        key={series.id}
                        series={series}
                        onChangeOrder={(sortOrder) =>
                          updateSeriesOrderLocally(series.id, sortOrder)
                        }
                        onUnlink={() => void unlinkSeries(series.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-md border border-stone-200 bg-white px-4 py-12 text-center text-sm text-stone-500">
              表示グループを作成または選択してください
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function GroupFields({
  form,
  onChange,
}: {
  form: GroupFormState;
  onChange: (form: GroupFormState) => void;
}) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs font-semibold text-stone-600">名前</span>
        <input
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
          className="mt-1 h-9 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
        />
      </label>
      <label className="block">
        <span className="text-xs font-semibold text-stone-600">説明</span>
        <textarea
          value={form.description}
          onChange={(event) =>
            onChange({ ...form, description: event.target.value })
          }
          rows={3}
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-cyan-700"
        />
      </label>
      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-stone-600">並び順</span>
          <input
            type="number"
            value={form.sortOrder}
            onChange={(event) =>
              onChange({ ...form, sortOrder: event.target.value })
            }
            className="mt-1 h-9 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
          />
        </label>
        <label className="flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold text-stone-700">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) =>
              onChange({ ...form, isActive: event.target.checked })
            }
          />
          表示
        </label>
      </div>
    </div>
  );
}

function SeriesSearchCard({
  series,
  disabled,
  selected,
  onSelect,
  onLink,
}: {
  series: SeriesSearchResult;
  disabled: boolean;
  selected: boolean;
  onSelect: () => void;
  onLink: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-stone-200 p-2">
      <input
        type="checkbox"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        className="size-4 shrink-0"
        aria-label={`${series.displayTitle}を選択`}
      />
      <SeriesThumb src={series.representativeImageUrl} title={series.displayTitle} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-stone-900">
          {series.displayTitle}
        </p>
        <p className="truncate text-xs text-stone-500">{series.searchTitle}</p>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onLink}
        className="flex h-8 items-center gap-1 rounded-md border border-stone-300 px-2 text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-40"
      >
        <Link2 className="size-3.5" />
        {disabled ? "追加済み" : "追加"}
      </button>
    </div>
  );
}

function LinkedSeriesRow({
  series,
  onChangeOrder,
  onUnlink,
}: {
  series: LinkedSeries;
  onChangeOrder: (sortOrder: number) => void;
  onUnlink: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-stone-200 p-2">
      <SeriesThumb src={series.representativeImageUrl} title={series.displayTitle} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-stone-900">
          {series.displayTitle}
        </p>
        <p className="truncate text-xs text-stone-500">{series.searchTitle}</p>
      </div>
      <input
        type="number"
        min={0}
        value={series.sortOrder}
        onChange={(event) =>
          onChangeOrder(Number.parseInt(event.target.value, 10))
        }
        className="h-8 w-20 rounded-md border border-stone-300 px-2 text-sm outline-none focus:border-cyan-700"
        aria-label={`${series.displayTitle}の並び順`}
      />
      <button
        type="button"
        title="解除"
        onClick={onUnlink}
        className="flex size-8 items-center justify-center rounded-md border border-stone-300 text-stone-600 hover:bg-stone-100"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function SeriesThumb({
  src,
  title,
}: {
  src: string | null;
  title: string;
}) {
  if (!src) {
    return (
      <div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-stone-100 text-xs font-semibold text-stone-400">
        no image
      </div>
    );
  }

  return (
    <div className="relative size-14 shrink-0 overflow-hidden rounded-md bg-stone-100">
      <Image src={src} alt={`${title}の代表画像`} fill unoptimized className="object-cover" />
    </div>
  );
}
