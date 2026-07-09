import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
export const runtime = "nodejs";

const OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4.1";
const DEFAULT_WEB_SEARCH_TOOL_TYPE = "web_search_preview";
const MAX_SUBMIT_LIMIT = 5000;

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
    if (mode === "submit") {
      return Response.json(await submitSeriesSummaryBatch(request));
    }

    if (mode === "status") {
      return Response.json(await getBatchStatus(request));
    }

    if (mode === "import") {
      return Response.json(await importBatchResult(request));
    }

    return Response.json(
      { ok: false, error: "mode must be submit, status, or import." },
      { status: 400 },
    );
  } catch (error) {
    console.error("[Series summary batch] Failed.", error);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}

async function submitSeriesSummaryBatch(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    offset?: number;
    includeDescribed?: boolean;
    includeImageSet?: boolean;
    model?: string;
    webSearchToolType?: string;
  };
  const limit = clampPositiveInteger(body.limit ?? 50, MAX_SUBMIT_LIMIT);
  const offset = Math.max(0, Math.floor(body.offset ?? 0));
  const model =
    body.model?.trim() || process.env.OPENAI_SUMMARY_MODEL || DEFAULT_MODEL;
  const webSearchToolType =
    body.webSearchToolType?.trim() ||
    process.env.OPENAI_WEB_SEARCH_TOOL_TYPE ||
    DEFAULT_WEB_SEARCH_TOOL_TYPE;
  const supabase = createSupabaseAdminClient();
  const seriesRows = await fetchTargetSeries({
    supabase,
    limit,
    offset,
    includeDescribed: body.includeDescribed === true,
    includeImageSet: body.includeImageSet === true,
  });
  const context = await fetchSeriesContext(
    supabase,
    seriesRows.map((row) => row.id),
  );
  const jsonl = `${seriesRows
    .map((series) =>
      JSON.stringify(
        createBatchRequest(series, context.get(series.id), {
          model,
          webSearchToolType,
        }),
      ),
    )
    .join("\n")}\n`;
  const file = await uploadOpenAIJsonlFile({
    content: jsonl,
    filename: `series-summary-input-${formatTimestamp(new Date())}.jsonl`,
  });
  const batch = await openAIRequest("/batches", {
    method: "POST",
    json: {
      input_file_id: file.id,
      endpoint: "/v1/responses",
      completion_window: "24h",
      metadata: {
        job: "series-summary-web-search",
        source: "server",
      },
    },
  });

  return {
    ok: true,
    mode: "submit",
    limit,
    offset,
    model,
    webSearchToolType,
    requestCount: seriesRows.length,
    includeDescribed: body.includeDescribed === true,
    includeImageSet: body.includeImageSet === true,
    inputFileId: file.id,
    batchId: batch.id,
    status: batch.status,
  };
}

async function getBatchStatus(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    batchId?: string;
  };
  const batchId = body.batchId?.trim();

  if (!batchId) {
    throw new Error("batchId is required.");
  }

  const batch = await openAIRequest(`/batches/${encodeURIComponent(batchId)}`);

  return { ok: true, mode: "status", batch };
}

async function importBatchResult(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    batchId?: string;
    apply?: boolean;
    acceptLowConfidence?: boolean;
  };
  const batchId = body.batchId?.trim();

  if (!batchId) {
    throw new Error("batchId is required.");
  }

  const batch = await openAIRequest(`/batches/${encodeURIComponent(batchId)}`);

  if (batch.status !== "completed") {
    return {
      ok: false,
      mode: "import",
      error: "Batch is not completed.",
      status: batch.status,
    };
  }

  if (!batch.output_file_id) {
    throw new Error("Batch output_file_id is missing.");
  }

  const output = await downloadOpenAIFile(batch.output_file_id);
  const rows = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseBatchOutputLine(line, index + 1));
  const accepted: SummaryResult[] = [];
  const review: Array<Record<string, string>> = [];

  for (const row of rows) {
    if (row.error) {
      review.push({
        customId: row.customId,
        id: "",
        title: "",
        reason: row.error,
        confidence: "",
        needsReview: "",
        notes: "",
      });
      continue;
    }

    const validationError = validateSummary(
      row.summary,
      body.acceptLowConfidence === true,
    );

    if (validationError) {
      review.push({
        customId: row.customId,
        id: row.summary?.id ?? "",
        title: row.summary?.title ?? "",
        reason: validationError,
        confidence: row.summary?.confidence ?? "",
        needsReview: String(row.summary?.needs_review ?? ""),
        notes: row.summary?.notes ?? "",
      });
      continue;
    }

    if (row.summary) {
      accepted.push(row.summary);
    }
  }

  let updatedCount = 0;

  if (body.apply === true && accepted.length > 0) {
    const supabase = createSupabaseAdminClient();

    for (const summary of accepted) {
      const { error } = await supabase
        .from("series")
        .update({
          description: summary.summary,
          updated_at: new Date().toISOString(),
        })
        .eq("id", summary.id);

      if (error) {
        review.push({
          customId: `series:${summary.id}`,
          id: summary.id,
          title: summary.title,
          reason: error.message,
          confidence: summary.confidence,
          needsReview: String(summary.needs_review),
          notes: summary.notes,
        });
      } else {
        updatedCount += 1;
      }
    }
  }

  return {
    ok: true,
    mode: "import",
    apply: body.apply === true,
    total: rows.length,
    acceptedCount: accepted.length,
    reviewCount: review.length,
    updatedCount,
    reviewSample: review.slice(0, 50),
  };
}

async function fetchTargetSeries({
  supabase,
  limit,
  offset,
  includeDescribed,
  includeImageSet,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  limit: number;
  offset: number;
  includeDescribed: boolean;
  includeImageSet: boolean;
}) {
  let query = supabase
    .from("series")
    .select("id, display_title, search_title, description, representative_image_path")
    .order("display_title", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (!includeDescribed) {
    query = query.or("description.is.null,description.eq.");
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

function createBatchRequest(
  series: SeriesRow,
  context: SeriesContext | undefined,
  {
    model,
    webSearchToolType,
  }: {
    model: string;
    webSearchToolType: string;
  },
) {
  return {
    custom_id: `series:${series.id}`,
    method: "POST",
    url: "/v1/responses",
    body: {
      model,
      tools: [{ type: webSearchToolType }],
      input: [
        {
          role: "system",
          content: [
            "あなたは漫画紹介文を作る編集者です。",
            "必要に応じてWeb検索を使い、作品情報を確認してください。",
            "タイトルだけで断定せず、作者名・出版社・掲載誌・ジャンルと照合してください。",
            "公式サイト、出版社、信頼できる作品データベース、書店情報を優先してください。",
            "調べた情報をそのまま写さず、自然な作品紹介として再構成してください。",
            "適度に改行を入れてください。",
            "「だ」「である」で文末を終わらせないでください。",
            "体言止めを多用しすぎないでください。",
            "ネタバレしすぎないでください。",
            "不明な情報は補完しないでください。",
            "同名作品などで特定できない場合や情報源が弱い場合は needs_review=true にしてください。",
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
    },
  };
}

async function uploadOpenAIJsonlFile({
  content,
  filename,
}: {
  content: string;
  filename: string;
}) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([content], { type: "application/jsonl" }),
    filename,
  );
  form.append("purpose", "batch");

  const response = await fetch(`${OPENAI_API_BASE}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requiredOpenAIKey()}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(await formatOpenAIError(response));
  }

  return response.json();
}

async function downloadOpenAIFile(fileId: string) {
  const response = await fetch(
    `${OPENAI_API_BASE}/files/${encodeURIComponent(fileId)}/content`,
    { headers: { Authorization: `Bearer ${requiredOpenAIKey()}` } },
  );

  if (!response.ok) {
    throw new Error(await formatOpenAIError(response));
  }

  return response.text();
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

function parseBatchOutputLine(line: string, lineNumber: number) {
  let parsed: {
    custom_id?: string;
    error?: { message?: string };
    response?: {
      status_code?: number;
      body?: {
        error?: { message?: string };
        output_text?: string;
        output?: Array<{ content?: Array<{ text?: string }> }>;
      };
    };
  };

  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return {
      customId: "",
      error: `Line ${lineNumber}: invalid JSON: ${
        error instanceof Error ? error.message : "unknown"
      }`,
      summary: null,
    };
  }

  const customId = parsed.custom_id ?? "";

  if (parsed.error) {
    return {
      customId,
      error: parsed.error.message ?? JSON.stringify(parsed.error),
      summary: null,
    };
  }

  const statusCode = parsed.response?.status_code;

  if (statusCode && (statusCode < 200 || statusCode >= 300)) {
    return {
      customId,
      error:
        parsed.response?.body?.error?.message ??
        `OpenAI response status ${statusCode}`,
      summary: null,
    };
  }

  const outputText = extractOutputText(parsed.response?.body);

  if (!outputText) {
    return { customId, error: "No output text found.", summary: null };
  }

  try {
    return {
      customId,
      error: null,
      summary: JSON.parse(outputText) as SummaryResult,
    };
  } catch (error) {
    return {
      customId,
      error: `Invalid summary JSON: ${
        error instanceof Error ? error.message : "unknown"
      }`,
      summary: null,
    };
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

  if (summary.summary.length < 80) {
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
    return 50;
  }

  return Math.min(normalized, max);
}

function firstRelation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] : value;
}

function formatList(values: string[] = []) {
  return values.length ? values.join(", ") : "不明";
}

function formatTimestamp(date: Date) {
  const pad = (value: number, length = 2) =>
    value.toString().padStart(length, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
