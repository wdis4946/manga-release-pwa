"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ListChecks,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import type { ManagedAgent } from "@/lib/admin/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type AgentsResponse = {
  agents: ManagedAgent[];
  page: number;
  pageSize: number;
  total: number;
};

type AgentFormState = {
  name: string;
  birthDate: string;
  activeStartYear: string;
  activeEndYear: string;
  birthPlace: string;
  authorWikiLink: string;
  gender: string;
};

type AgentsManagementConsoleProps = {
  initialQuery?: string;
};

const emptyForm: AgentFormState = {
  name: "",
  birthDate: "",
  activeStartYear: "",
  activeEndYear: "",
  birthPlace: "",
  authorWikiLink: "",
  gender: "",
};

function toFormState(agent: ManagedAgent): AgentFormState {
  return {
    name: agent.name,
    birthDate: agent.birthDate ?? "",
    activeStartYear: agent.activeStartYear?.toString() ?? "",
    activeEndYear: agent.activeEndYear?.toString() ?? "",
    birthPlace: agent.birthPlace ?? "",
    authorWikiLink: agent.authorWikiLink ?? "",
    gender: agent.gender ?? "",
  };
}

function toRequestBody(form: AgentFormState) {
  const parseYear = (value: string) => {
    const trimmed = value.trim();
    return trimmed ? Number(trimmed) : null;
  };

  return {
    name: form.name.trim(),
    birthDate: form.birthDate.trim() || null,
    activeStartYear: parseYear(form.activeStartYear),
    activeEndYear: parseYear(form.activeEndYear),
    birthPlace: form.birthPlace.trim() || null,
    authorWikiLink: form.authorWikiLink.trim() || null,
    gender: form.gender.trim() || null,
  };
}

export function AgentsManagementConsole({
  initialQuery = "",
}: AgentsManagementConsoleProps) {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [queryText, setQueryText] = useState(initialQuery);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editForm, setEditForm] = useState<AgentFormState>(emptyForm);
  const [newForm, setNewForm] = useState<AgentFormState>(emptyForm);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  const pageCount = Math.max(1, Math.ceil(total / 50));
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
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

  const loadAgents = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(page),
    });

    if (queryText.trim()) {
      params.set("q", queryText.trim());
    }

    const response = await authorizedFetch(`/api/admin/agents?${params}`);

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (requestId !== requestIdRef.current) {
      return;
    }

    if (!response.ok) {
      setError("作者一覧を取得できませんでした。");
      setIsLoading(false);
      return;
    }

    const data = (await response.json()) as AgentsResponse;
    if (requestId !== requestIdRef.current) {
      return;
    }

    setAgents(data.agents);
    setTotal(data.total);
    const nextSelectedAgentId = data.agents.some(
      (agent) => agent.id === selectedAgentId,
    )
      ? selectedAgentId
      : (data.agents[0]?.id ?? "");
    const nextSelectedAgent =
      data.agents.find((agent) => agent.id === nextSelectedAgentId) ?? null;

    setSelectedAgentId(nextSelectedAgentId);
    setEditForm(nextSelectedAgent ? toFormState(nextSelectedAgent) : emptyForm);
    setIsLoading(false);
  }, [
    accessToken,
    authorizedFetch,
    handleUnauthorized,
    page,
    queryText,
    selectedAgentId,
  ]);

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
    const timeout = window.setTimeout(() => void loadAgents(), 250);
    return () => window.clearTimeout(timeout);
  }, [loadAgents]);

  useEffect(() => {
    requestIdRef.current += 1;
  }, [page, queryText]);

  function updateEditForm(patch: Partial<AgentFormState>) {
    setEditForm((current) => ({ ...current, ...patch }));
  }

  function updateNewForm(patch: Partial<AgentFormState>) {
    setNewForm((current) => ({ ...current, ...patch }));
  }

  async function saveAgent(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedAgent || !editForm.name.trim()) {
      return;
    }

    setIsSaving(true);
    setError("");
    const response = await authorizedFetch(`/api/admin/agents/${selectedAgent.id}`, {
      method: "PATCH",
      body: JSON.stringify(toRequestBody(editForm)),
    });

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError(
        response.status === 409
          ? "同じ名前の作者が既に存在します。"
          : "作者情報を保存できませんでした。",
      );
      setIsSaving(false);
      return;
    }

    const data = (await response.json()) as { agent: ManagedAgent };
    setAgents((current) =>
      current.map((agent) => (agent.id === data.agent.id ? data.agent : agent)),
    );
    setEditForm(toFormState(data.agent));
    setIsSaving(false);
  }

  async function createAgent(event: React.FormEvent) {
    event.preventDefault();

    if (!newForm.name.trim()) {
      return;
    }

    setIsCreating(true);
    setError("");
    const response = await authorizedFetch("/api/admin/agents", {
      method: "POST",
      body: JSON.stringify(toRequestBody(newForm)),
    });

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      setError(
        response.status === 409
          ? "同じ名前の作者が既に存在します。"
          : "作者を追加できませんでした。",
      );
      setIsCreating(false);
      return;
    }

    const data = (await response.json()) as { agent: ManagedAgent };
    setNewForm(emptyForm);
    setSelectedAgentId(data.agent.id);
    await loadAgents();
    setIsCreating(false);
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
            <h1 className="text-lg font-bold text-stone-950">作者管理</h1>
            <p className="text-xs text-stone-500">
              {total.toLocaleString("ja-JP")}人
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/series"
              className="flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 hover:bg-stone-100"
            >
              <ListChecks className="size-4" />
              シリーズ管理
            </Link>
            <button
              type="button"
              title="再読み込み"
              onClick={() => void loadAgents()}
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
              void loadAgents();
            }}
          >
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-4 text-stone-400" />
              <input
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                placeholder="作者名で検索"
                className="h-9 w-full rounded-md border border-stone-300 pl-9 pr-3 text-sm outline-none focus:border-cyan-700"
              />
            </div>
          </form>

          <div className="max-h-[60vh] overflow-y-auto xl:max-h-[calc(100vh-227px)]">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <LoaderCircle className="size-5 animate-spin text-cyan-700" />
              </div>
            ) : agents.length === 0 ? (
              <p className="p-6 text-center text-sm text-stone-500">
                作者がありません
              </p>
            ) : (
              agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => {
                    setSelectedAgentId(agent.id);
                    setEditForm(toFormState(agent));
                  }}
                  className={`w-full border-b border-stone-100 p-3 text-left ${
                    selectedAgentId === agent.id
                      ? "bg-cyan-50"
                      : "hover:bg-stone-50"
                  }`}
                >
                  <p className="text-sm font-semibold text-stone-900">
                    {agent.name}
                  </p>
                  {agent.authorWikiLink ? (
                    <p className="mt-1 truncate text-xs text-stone-500">
                      {agent.authorWikiLink}
                    </p>
                  ) : null}
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

        <section className="min-w-0 space-y-4 p-4 sm:p-6 xl:h-[calc(100vh-130px)] xl:overflow-y-auto">
          {error ? (
            <p className="border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <AgentForm
            title="新規作者追加"
            form={newForm}
            isSaving={isCreating}
            submitLabel="追加"
            submitIcon={<Plus className="size-4" />}
            onSubmit={createAgent}
            onChange={updateNewForm}
          />

          {selectedAgent ? (
            <AgentForm
              title={`作者編集: ${selectedAgent.name}`}
              form={editForm}
              isSaving={isSaving}
              submitLabel="保存"
              submitIcon={<Check className="size-4" />}
              onSubmit={saveAgent}
              onChange={updateEditForm}
            />
          ) : (
            <div className="rounded-md border border-stone-200 bg-white px-4 py-12 text-center text-sm text-stone-500">
              編集する作者を選択してください
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function AgentForm({
  title,
  form,
  isSaving,
  submitLabel,
  submitIcon,
  onSubmit,
  onChange,
}: {
  title: string;
  form: AgentFormState;
  isSaving: boolean;
  submitLabel: string;
  submitIcon: React.ReactNode;
  onSubmit: (event: React.FormEvent) => void;
  onChange: (patch: Partial<AgentFormState>) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-stone-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold text-stone-950">{title}</h2>
        <button
          type="submit"
          disabled={isSaving || !form.name.trim()}
          className="flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-bold text-white hover:bg-cyan-800 disabled:opacity-40"
        >
          {isSaving ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            submitIcon
          )}
          {submitLabel}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <TextField
          label="作者名"
          value={form.name}
          required
          onChange={(value) => onChange({ name: value })}
        />
        <TextField
          label="性別"
          value={form.gender}
          onChange={(value) => onChange({ gender: value })}
        />
        <TextField
          label="生年月日"
          type="date"
          value={form.birthDate}
          onChange={(value) => onChange({ birthDate: value })}
        />
        <TextField
          label="出生地"
          value={form.birthPlace}
          onChange={(value) => onChange({ birthPlace: value })}
        />
        <TextField
          label="活動開始年"
          type="number"
          value={form.activeStartYear}
          onChange={(value) => onChange({ activeStartYear: value })}
        />
        <TextField
          label="活動終了年"
          type="number"
          value={form.activeEndYear}
          onChange={(value) => onChange({ activeEndYear: value })}
        />
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[11px] font-semibold text-stone-500">
            作者Wiki URL
          </span>
          <input
            value={form.authorWikiLink}
            onChange={(event) =>
              onChange({ authorWikiLink: event.target.value })
            }
            placeholder="https://ja.wikipedia.org/wiki/..."
            className="h-9 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
          />
        </label>
      </div>
    </form>
  );
}

function TextField({
  label,
  value,
  type = "text",
  required = false,
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-stone-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-cyan-700"
      />
    </label>
  );
}
