import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
export const runtime = "nodejs";

const OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4.1";
const DEFAULT_WEB_SEARCH_TOOL_TYPE = "web_search_preview";
const MAX_ENQUEUE_LIMIT = 5000;
const MAX_WORKER_LIMIT = 10;
const MIN_SUMMARY_LENGTH = 220;

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    needs_review: { type: "boolean" },
    notes: { type: "string" },
    source_urls: { type: "array", items: { type: "string" } },
  },
  required: [
    "id",
    "title",
    "summary",
    "confidence",
    "needs_review",
    "notes",
    "source_urls",
  ],
  additionalProperties: false,
} as const;

type SeriesRow = {
  id: string;
  display_title: string;
  search_title: string;
  description: string | null;
  representative_image_path: string | null;
};

type ClaimedJob = {
  id: string;
  series_id: string;
  attempts: number;
  max_attempts: number;
};

type SeriesContext = {
  authors: string[];
  publishers: string[];
  imprints: string[];
  genres: string[];
};

type SummaryResult = {
  id: string;
  title: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  needs_review: boolean;
  notes: string;
  source_urls: string[];
};

export async function POST(request: Request) {
  const authError = authorizeCronRequest(request);

  if (authError) {
    return authError;
  }

  const mode = new URL(request.url).searchParams.get("mode");

  try {
    if (mode === "enqueue") {
      return Response.json(await enqueueSummaryJobs(request));
    }

    if (mode === "run") {
      return Response.json(await runSummaryJobs(request));
    }

    if (mode === "status") {
      return Response.json(await getSummaryJobStatus());
    }

    if (mode === "clear") {
      return Response.json(await clearSummaryJobs(request));
    }

    return Response.json(
      { ok: false, error: "mode must be enqueue, run, status, or clear." },
      { status: 400 },
    );
  } catch (error) {
    console.error("[Series summary jobs] Failed.", error);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}

async function enqueueSummaryJobs(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    offset?: number;
    includeUndescribed?: boolean;
    includeImageSet?: boolean;
    maxAttempts?: number;
  };
  const limit = clampPositiveInteger(body.limit ?? 100, MAX_ENQUEUE_LIMIT);
  const offset = Math.max(0, Math.floor(body.offset ?? 0));
  const maxAttempts = clampPositiveInteger(body.maxAttempts ?? 3, 10);
  const supabase = createSupabaseAdminClient();
  const seriesRows = await fetchTargetSeries({
    supabase,
    limit,
    offset,
    includeUndescribed: body.includeUndescribed === true,
    includeImageSet: body.includeImageSet === true,
  });
  const jobs = seriesRows.map((series) => ({
    series_id: series.id,
    status: "pending",
    max_attempts: maxAttempts,
    updated_at: new Date().toISOString(),
  }));
  let insertedCount = 0;

  for (let index = 0; index < jobs.length; index += 500) {
    const inserted = await insertJobsIndividually(
      supabase,
      jobs.slice(index, index + 500),
    );
    insertedCount += inserted;
  }

  return {
    ok: true,
    mode: "enqueue",
    limit,
    offset,
    includeUndescribed: body.includeUndescribed === true,
    includeImageSet: body.includeImageSet === true,
    defaultFilter: "description_present_and_representative_image_missing",
    targetCount: seriesRows.length,
    insertedCount,
    skippedExistingCount: seriesRows.length - insertedCount,
  };
}

async function runSummaryJobs(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    staleAfterMinutes?: number;
    model?: string;
    webSearchToolType?: string;
    apply?: boolean;
    acceptLowConfidence?: boolean;
  };
  const limit = clampPositiveInteger(body.limit ?? 1, MAX_WORKER_LIMIT);
  const staleAfterMinutes = clampPositiveInteger(
    body.staleAfterMinutes ?? 30,
    24 * 60,
  );
  const apply = body.apply !== false;
  const model =
    body.model?.trim() || process.env.OPENAI_SUMMARY_MODEL || DEFAULT_MODEL;
  const webSearchToolType =
    body.webSearchToolType?.trim() ||
    process.env.OPENAI_WEB_SEARCH_TOOL_TYPE ||
    DEFAULT_WEB_SEARCH_TOOL_TYPE;
  const supabase = createSupabaseAdminClient();
  const { data: claimedJobs, error: claimError } = await supabase.rpc(
    "claim_series_summary_jobs",
    {
      p_limit: limit,
      p_stale_after_minutes: staleAfterMinutes,
    },
  );

  if (claimError) {
    throw claimError;
  }

  const jobs = (claimedJobs ?? []) as ClaimedJob[];

  if (jobs.length === 0) {
    return {
      ok: true,
      mode: "run",
      model,
      webSearchToolType,
      claimedCount: 0,
      completedCount: 0,
      needsReviewCount: 0,
      failedCount: 0,
      results: [],
    };
  }

  const seriesRows = await fetchSeriesRowsByIds(
    supabase,
    jobs.map((job) => job.series_id),
  );
  const seriesById = new Map(seriesRows.map((series) => [series.id, series]));
  const context = await fetchSeriesContext(
    supabase,
    seriesRows.map((series) => series.id),
  );
  const results = [];
  let completedCount = 0;
  let needsReviewCount = 0;
  let failedCount = 0;

  for (const job of jobs) {
    const series = seriesById.get(job.series_id);

    if (!series) {
      await markJobFailed({
        supabase,
        job,
        errorMessage: "Series was not found.",
      });
      failedCount += 1;
      results.push({
        jobId: job.id,
        seriesId: job.series_id,
        status: "failed",
        error: "Series was not found.",
      });
      continue;
    }

    try {
      const summary = await createSeriesSummary({
        series,
        context: context.get(series.id),
        model,
        webSearchToolType,
      });
      const validationError = validateSummary(
        summary,
        body.acceptLowConfidence === true,
      );

      if (validationError) {
        await markJobNeedsReview({
          supabase,
          jobId: job.id,
          summary,
          errorMessage: validationError,
        });
        needsReviewCount += 1;
        results.push({
          jobId: job.id,
          seriesId: series.id,
          title: series.display_title,
          status: "needs_review",
          reason: validationError,
        });
        continue;
      }

      if (apply) {
        const { error: updateError } = await supabase
          .from("series")
          .update({
            description: summary.summary,
            updated_at: new Date().toISOString(),
          })
          .eq("id", series.id);

        if (updateError) {
          throw updateError;
        }
      }

      await markJobCompleted({
        supabase,
        jobId: job.id,
        summary,
      });
      completedCount += 1;
      results.push({
        jobId: job.id,
        seriesId: series.id,
        title: series.display_title,
        status: "completed",
        applied: apply,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      const retryable = job.attempts < job.max_attempts;

      await markJobFailed({
        supabase,
        job,
        errorMessage: message,
        retryable,
      });
      failedCount += 1;
      results.push({
        jobId: job.id,
        seriesId: series.id,
        title: series.display_title,
        status: retryable ? "pending" : "failed",
        error: message,
      });
    }
  }

  return {
    ok: true,
    mode: "run",
    model,
    webSearchToolType,
    apply,
    claimedCount: jobs.length,
    completedCount,
    needsReviewCount,
    failedCount,
    results,
  };
}

async function getSummaryJobStatus() {
  const supabase = createSupabaseAdminClient();
  const statuses = [
    "pending",
    "processing",
    "completed",
    "needs_review",
    "failed",
  ];
  const counts: Record<string, number> = {};

  for (const status of statuses) {
    const { count, error } = await supabase
      .from("series_summary_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

    if (error) {
      throw error;
    }

    counts[status] = count ?? 0;
  }

  const { data: recentProblemJobs, error } = await supabase
    .from("series_summary_jobs")
    .select("id, series_id, status, attempts, error_message, updated_at")
    .in("status", ["needs_review", "failed"])
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error) {
    throw error;
  }

  return {
    ok: true,
    mode: "status",
    counts,
    recentProblemJobs: recentProblemJobs ?? [],
  };
}

async function clearSummaryJobs(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    all?: boolean;
    statuses?: string[];
  };
  const allowedStatuses = [
    "pending",
    "processing",
    "completed",
    "needs_review",
    "failed",
  ];
  const statuses = body.all
    ? allowedStatuses
    : body.statuses?.length
      ? body.statuses.filter((status) => allowedStatuses.includes(status))
      : ["pending", "processing"];

  if (statuses.length === 0) {
    throw new Error("No valid statuses were provided.");
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("series_summary_jobs")
    .delete()
    .in("status", statuses)
    .select("id");

  if (error) {
    throw error;
  }

  return {
    ok: true,
    mode: "clear",
    statuses,
    deletedCount: data?.length ?? 0,
  };
}

async function insertJobsIndividually(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  jobs: Array<{
    series_id: string;
    status: string;
    max_attempts: number;
    updated_at: string;
  }>,
) {
  let insertedCount = 0;

  for (const job of jobs) {
    const { error } = await supabase.from("series_summary_jobs").insert(job);

    if (!error) {
      insertedCount += 1;
      continue;
    }

    if (error.code !== "23505") {
      throw error;
    }
  }

  return insertedCount;
}

async function fetchTargetSeries({
  supabase,
  limit,
  offset,
  includeUndescribed,
  includeImageSet,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  limit: number;
  offset: number;
  includeUndescribed: boolean;
  includeImageSet: boolean;
}) {
  let query = supabase
    .from("series")
    .select(
      "id, display_title, search_title, description, representative_image_path",
    )
    .order("display_title", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (!includeUndescribed) {
    query = query.not("description", "is", null).neq("description", "");
  }

  if (!includeImageSet) {
    query = query.is("representative_image_path", null);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as SeriesRow[];
}

async function fetchSeriesRowsByIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  seriesIds: string[],
) {
  const rows: SeriesRow[] = [];

  for (let index = 0; index < seriesIds.length; index += 200) {
    const chunk = seriesIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("series")
      .select(
        "id, display_title, search_title, description, representative_image_path",
      )
      .in("id", chunk);

    if (error) {
      throw error;
    }

    rows.push(...((data ?? []) as SeriesRow[]));
  }

  return rows;
}

async function fetchSeriesContext(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  seriesIds: string[],
) {
  const context = new Map<string, SeriesContext>(
    seriesIds.map((seriesId) => [
      seriesId,
      { authors: [], publishers: [], imprints: [], genres: [] },
    ]),
  );

  if (seriesIds.length === 0) {
    return context;
  }

  for (let index = 0; index < seriesIds.length; index += 200) {
    const chunk = seriesIds.slice(index, index + 200);
    const [agentResult, publisherResult, genreResult] = await Promise.all([
      supabase
        .from("series_agents")
        .select("series_id, sort_order, agents(name, author_wiki_link)")
        .in("series_id", chunk)
        .order("sort_order", { ascending: true }),
      supabase
        .from("series_publishers")
        .select("series_id, publishers(imprint_name, publisher_name)")
        .in("series_id", chunk),
      supabase
        .from("series_genres")
        .select("series_id, genres(name)")
        .in("series_id", chunk),
    ]);

    if (agentResult.error) {
      throw agentResult.error;
    }

    if (publisherResult.error) {
      throw publisherResult.error;
    }

    if (genreResult.error) {
      throw genreResult.error;
    }

    for (const row of agentResult.data ?? []) {
      const entry = context.get(row.series_id);
      const agent = firstRelation(row.agents);

      if (entry && agent?.name && !entry.authors.includes(agent.name)) {
        entry.authors.push(agent.name);
      }
    }

    for (const row of publisherResult.data ?? []) {
      const entry = context.get(row.series_id);
      const publisher = firstRelation(row.publishers);

      if (!entry || !publisher) {
        continue;
      }

      if (
        publisher.publisher_name &&
        !entry.publishers.includes(publisher.publisher_name)
      ) {
        entry.publishers.push(publisher.publisher_name);
      }

      if (
        publisher.imprint_name &&
        !entry.imprints.includes(publisher.imprint_name)
      ) {
        entry.imprints.push(publisher.imprint_name);
      }
    }

    for (const row of genreResult.data ?? []) {
      const entry = context.get(row.series_id);
      const genre = firstRelation(row.genres);

      if (entry && genre?.name && !entry.genres.includes(genre.name)) {
        entry.genres.push(genre.name);
      }
    }
  }

  return context;
}

async function createSeriesSummary({
  series,
  context,
  model,
  webSearchToolType,
}: {
  series: SeriesRow;
  context: SeriesContext | undefined;
  model: string;
  webSearchToolType: string;
}) {
  const body = {
    model,
    tools: [{ type: webSearchToolType }],
    input: [
      {
        role: "system",
        content: [
          "あなたは漫画紹介文を作る編集者です。",
          "必要に応じてWeb検索を使い、作品情報を確認してください。",
          "あらすじは日本語で300文字前後を目安に、短すぎず読み応えのある紹介文にしてください。",
          "構成は、冒頭に作品全体の要約、次に物語の始まり、続いて今後の展開を想像させる内容、最後に作品の魅力をまとめる流れにしてください。",
          "段落は3〜5段落程度に分け、読みやすい改行を入れてください。",
          "冒頭では、作品名、主要人物、ジャンルや題材が自然に分かるようにしてください。",
          "中盤では、物語が動き出すきっかけや主人公が向き合う課題を説明してください。",
          "終盤では、核心的な結末を明かさず、読者が先を読みたくなる余韻を残してください。",
          "調べた情報をそのまま写さず、作品紹介として自然な日本語に再構成してください。",
          "生成するあらすじ本文は、ですます調を使わないでください。",
          "生成するあらすじ本文は、「だ」「である」調も使わないでください。",
          "文末は説明的に硬く締めず、作品紹介として自然で余韻のある表現にしてください。",
          "体言止めを多用しすぎないでください。",
          "ネタバレしすぎないでください。",
          "不明な情報は補完しないでください。",
          "同名作品などで特定できない場合や情報不足の場合は needs_review=true にしてください。",
          "確認に使った主要なURLを source_urls に入れてください。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `id: ${series.id}`,
          `title: ${series.display_title}`,
          `search_title: ${series.search_title}`,
          `authors: ${formatList(context?.authors)}`,
          `publishers: ${formatList(context?.publishers)}`,
          `imprints: ${formatList(context?.imprints)}`,
          `genres: ${formatList(context?.genres)}`,
        ].join("\n"),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "manga_summary",
        strict: true,
        schema: SUMMARY_SCHEMA,
      },
    },
  };
  const response = await openAIRequest("/responses", {
    method: "POST",
    json: body,
  });
  const outputText = extractOutputText(response);

  if (!outputText) {
    throw new Error("No output text found.");
  }

  return JSON.parse(outputText) as SummaryResult;
}

async function markJobCompleted({
  supabase,
  jobId,
  summary,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  jobId: string;
  summary: SummaryResult;
}) {
  const { error } = await supabase
    .from("series_summary_jobs")
    .update({
      status: "completed",
      summary: summary.summary,
      confidence: summary.confidence,
      needs_review: summary.needs_review,
      notes: summary.notes,
      source_urls: summary.source_urls,
      error_message: null,
      locked_at: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw error;
  }
}

async function markJobNeedsReview({
  supabase,
  jobId,
  summary,
  errorMessage,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  jobId: string;
  summary: SummaryResult | null;
  errorMessage: string;
}) {
  const { error } = await supabase
    .from("series_summary_jobs")
    .update({
      status: "needs_review",
      summary: summary?.summary ?? null,
      confidence: summary?.confidence ?? null,
      needs_review: summary?.needs_review ?? true,
      notes: summary?.notes ?? null,
      source_urls: summary?.source_urls ?? [],
      error_message: errorMessage,
      locked_at: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw error;
  }
}

async function markJobFailed({
  supabase,
  job,
  errorMessage,
  retryable = false,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  job: ClaimedJob;
  errorMessage: string;
  retryable?: boolean;
}) {
  const { error } = await supabase
    .from("series_summary_jobs")
    .update({
      status: retryable ? "pending" : "failed",
      error_message: errorMessage,
      locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  if (error) {
    throw error;
  }
}

async function openAIRequest(
  path: string,
  options: { method?: string; json?: unknown } = {},
) {
  const response = await fetch(`${OPENAI_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${requiredOpenAIKey()}`,
      "Content-Type": "application/json",
    },
    body: options.json ? JSON.stringify(options.json) : undefined,
  });

  if (!response.ok) {
    throw new Error(await formatOpenAIError(response));
  }

  return response.json();
}

async function formatOpenAIError(response: Response) {
  const text = await response.text();

  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    return `${response.status} ${response.statusText}: ${
      body.error?.message ?? text
    }`;
  } catch {
    return `${response.status} ${response.statusText}: ${text}`;
  }
}

function extractOutputText(body?: {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
}) {
  if (!body) {
    return null;
  }

  if (typeof body.output_text === "string") {
    return body.output_text;
  }

  for (const output of body.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return null;
}

function validateSummary(
  summary: SummaryResult | null,
  acceptLowConfidence: boolean,
) {
  if (!summary) {
    return "summary is missing";
  }

  for (const key of SUMMARY_SCHEMA.required) {
    if (!(key in summary)) {
      return `${key} is missing`;
    }
  }

  if (!summary.id || !summary.title || !summary.summary) {
    return "id, title, or summary is empty";
  }

  if (!["high", "medium", "low"].includes(summary.confidence)) {
    return "confidence is invalid";
  }

  if (summary.needs_review) {
    return "needs_review is true";
  }

  if (!acceptLowConfidence && summary.confidence === "low") {
    return "confidence is low";
  }

  if (!Array.isArray(summary.source_urls) || summary.source_urls.length === 0) {
    return "source_urls is empty";
  }

  if (summary.summary.length < MIN_SUMMARY_LENGTH) {
    return "summary is too short";
  }

  return null;
}

function authorizeCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

function requiredOpenAIKey() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  return apiKey;
}

function clampPositiveInteger(value: number, max: number) {
  const normalized = Math.floor(value);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 1;
  }

  return Math.min(normalized, max);
}

function firstRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] : value;
}

function formatList(values: string[] = []) {
  return values.length ? values.join(", ") : "不明";
}
