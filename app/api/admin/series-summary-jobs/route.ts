import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
export const runtime = "nodejs";

const OPENAI_API_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_WEB_SEARCH_TOOL_TYPE = "web_search_preview";
const MAX_ENQUEUE_LIMIT = 5000;
const MAX_WORKER_LIMIT = 10;
const MAX_SOURCE_COLLECT_LIMIT = 50;
const MAX_SOURCES_PER_SERIES = 8;
const MAX_CRAWLER_SEARCH_PAGES_PER_SERIES = 12;
const MAX_SOURCE_TEXT_LENGTH = 5000;
const MAX_SOURCE_CONTEXT_LENGTH = 16000;
const MIN_SUMMARY_LENGTH = 300;
const MIN_ACCEPTED_SOURCE_SCORE = 80;

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

type SeriesSummarySource = {
  id: string;
  series_id: string;
  url: string;
  domain: string;
  source_type: SourceType;
  title: string | null;
  description: string | null;
  extracted_text: string | null;
  score: number;
  status: "pending" | "fetched" | "failed" | "ignored";
  error_message: string | null;
};

type SourceType =
  | "publisher_official"
  | "official_site"
  | "bibliographic"
  | "ebook_store"
  | "reference_database"
  | "other";

type SourceDiscoveryProvider = "none" | "crawler" | "google";

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

    if (mode === "collect-sources") {
      return Response.json(await collectSummarySources(request));
    }

    if (mode === "import-source-urls") {
      return Response.json(await importSummarySourceUrls(request));
    }

    if (mode === "status") {
      return Response.json(await getSummaryJobStatus());
    }

    if (mode === "clear") {
      return Response.json(await clearSummaryJobs(request));
    }

    return Response.json(
      {
        ok: false,
        error:
          "mode must be enqueue, run, collect-sources, import-source-urls, status, or clear.",
      },
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
  const activeJobCount = await countIncompleteSummaryJobs(supabase);
  const remainingCapacity = Math.max(0, limit - activeJobCount);
  const existingJobSeriesIds = await fetchSummaryJobSeriesIdSet(supabase);
  const seriesRows =
    remainingCapacity > 0
      ? await fetchTargetSeriesForEnqueue({
          supabase,
          limit: remainingCapacity,
          offset,
          includeUndescribed: body.includeUndescribed === true,
          includeImageSet: body.includeImageSet === true,
          excludedSeriesIds: existingJobSeriesIds,
        })
      : [];
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
    activeJobCountBefore: activeJobCount,
    desiredActiveJobCount: limit,
    remainingCapacity,
    candidateCount: seriesRows.length,
    targetCount: activeJobCount + insertedCount,
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
    allowWebSearchFallback?: boolean;
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
  const allowWebSearchFallback =
    body.allowWebSearchFallback === true ||
    process.env.OPENAI_ALLOW_WEB_SEARCH_FALLBACK === "true";
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
  const sourcesBySeriesId = await fetchUsableSummarySources(
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
      let summary = await createSeriesSummary({
        series,
        context: context.get(series.id),
        sources: sourcesBySeriesId.get(series.id) ?? [],
        model,
        webSearchToolType,
        allowWebSearch: allowWebSearchFallback,
      });
      let validationError = validateSummary(
        summary,
        body.acceptLowConfidence === true,
      );

      if (validationError === "summary is too short") {
        summary = await createSeriesSummary({
          series,
          context: context.get(series.id),
          sources: sourcesBySeriesId.get(series.id) ?? [],
          model,
          webSearchToolType,
          allowWebSearch: allowWebSearchFallback,
          retryForTooShort: true,
        });
        validationError = validateSummary(
          summary,
          body.acceptLowConfidence === true,
        );
      }

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
    sourceMode: allowWebSearchFallback ? "stored_sources_or_web" : "stored_sources",
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

async function collectSummarySources(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    offset?: number;
    includeUndescribed?: boolean;
    includeImageSet?: boolean;
    search?: boolean;
    refetch?: boolean;
  };
  const limit = clampPositiveInteger(
    body.limit ?? 10,
    MAX_SOURCE_COLLECT_LIMIT,
  );
  const offset = Math.max(0, Math.floor(body.offset ?? 0));
  const supabase = createSupabaseAdminClient();
  const seriesRows = await fetchTargetSeries({
    supabase,
    limit,
    offset,
    includeUndescribed: body.includeUndescribed === true,
    includeImageSet: body.includeImageSet === true,
  });
  const context = await fetchSeriesContext(
    supabase,
    seriesRows.map((series) => series.id),
  );
  const sourceProvider = getSourceDiscoveryProvider(body.search !== false);
  const isbnsBySeriesId =
    sourceProvider === "crawler"
      ? await fetchSeriesIsbns(
          supabase,
          seriesRows.map((series) => series.id),
        )
      : new Map<string, string[]>();
  const results = [];
  let discoveredUrlCount = 0;
  let fetchedCount = 0;
  let failedCount = 0;

  for (const series of seriesRows) {
    const seriesContext = context.get(series.id);
    const isbns = isbnsBySeriesId.get(series.id) ?? [];
    const publisherCandidates =
      sourceProvider === "crawler"
        ? [...inferPublisherCandidates(seriesContext, isbns)]
        : [];
    const existingSources = await fetchSummarySourcesForSeries(
      supabase,
      series.id,
    );
    const discoveredSourceDetails = await discoverSourceUrls({
      series,
      context: seriesContext,
      isbns,
      provider: sourceProvider,
    });
    const fetchedExistingUrls = existingSources
      .filter((source) => source.status === "fetched" && source.extracted_text)
      .map((source) => source.url);
    const refetchUrls =
      body.refetch === true ? existingSources.map((source) => source.url) : [];
    const urls = uniqueStrings([
      ...fetchedExistingUrls,
      ...discoveredSourceDetails.urls,
      ...refetchUrls,
    ]).slice(0, MAX_SOURCES_PER_SERIES);
    const sourceResults = [];

    discoveredUrlCount += discoveredSourceDetails.urls.length;

    for (const url of urls) {
      const existing = existingSources.find((source) => source.url === url);

      if (
        existing?.status === "fetched" &&
        existing.extracted_text &&
        body.refetch !== true
      ) {
        sourceResults.push({ url, status: "skipped" });
        continue;
      }

      const source = await fetchAndStoreSummarySource({
        supabase,
        series,
        context: seriesContext,
        isbns,
        seriesId: series.id,
        url,
      });

      if (source.status === "fetched") {
        fetchedCount += 1;
      } else if (source.status === "failed") {
        failedCount += 1;
      }

      sourceResults.push({
        url,
        status: source.status,
        sourceType: source.source_type,
        score: source.score,
        errorMessage: source.error_message,
      });
    }

    results.push({
      seriesId: series.id,
      title: series.display_title,
      isbns,
      publisherCandidates,
      isbnDirectUrls: discoveredSourceDetails.directUrls,
      searchResultUrls: discoveredSourceDetails.searchUrls,
      discoveredUrls: discoveredSourceDetails.urls,
      existingSourceCount: existingSources.length,
      discoveredSourceCount: discoveredSourceDetails.urls.length,
      processedSourceCount: sourceResults.length,
      sources: sourceResults,
    });
  }

  return {
    ok: true,
    mode: "collect-sources",
    limit,
    offset,
    searchEnabled: sourceProvider !== "none",
    sourceProvider,
    targetCount: seriesRows.length,
    discoveredUrlCount,
    fetchedCount,
    failedCount,
    results,
    requiredSettings: requiredSourceDiscoverySettings(sourceProvider),
  };
}

async function importSummarySourceUrls(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    sources?: Array<{ seriesId?: string; series_id?: string; urls?: string[] }>;
    fetch?: boolean;
  };
  const supabase = createSupabaseAdminClient();
  let insertedOrUpdatedCount = 0;
  let fetchedCount = 0;
  let failedCount = 0;

  for (const sourceGroup of body.sources ?? []) {
    const seriesId = sourceGroup.seriesId ?? sourceGroup.series_id;

    if (!seriesId) {
      continue;
    }

    for (const url of uniqueStrings(sourceGroup.urls ?? [])) {
      const normalizedUrl = normalizeUrl(url);

      if (!normalizedUrl) {
        continue;
      }

      await upsertSummarySource({
        supabase,
        seriesId,
        url: normalizedUrl,
        status: "pending",
      });
      insertedOrUpdatedCount += 1;

      if (body.fetch === true) {
        const source = await fetchAndStoreSummarySource({
          supabase,
          seriesId,
          url: normalizedUrl,
        });

        if (source.status === "fetched") {
          fetchedCount += 1;
        } else if (source.status === "failed") {
          failedCount += 1;
        }
      }
    }
  }

  return {
    ok: true,
    mode: "import-source-urls",
    importedUrlCount: insertedOrUpdatedCount,
    fetchedCount,
    failedCount,
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

async function countIncompleteSummaryJobs(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
) {
  const { count, error } = await supabase
    .from("series_summary_jobs")
    .select("id", { count: "exact", head: true })
    .neq("status", "completed");

  if (error) {
    throw error;
  }

  return count ?? 0;
}

async function fetchSummaryJobSeriesIdSet(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
) {
  const seriesIds = new Set<string>();
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("series_summary_jobs")
      .select("series_id")
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      if (row.series_id) {
        seriesIds.add(row.series_id);
      }
    }

    if (!data || data.length < pageSize) {
      break;
    }
  }

  return seriesIds;
}

async function fetchTargetSeriesForEnqueue({
  supabase,
  limit,
  offset,
  includeUndescribed,
  includeImageSet,
  excludedSeriesIds,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  limit: number;
  offset: number;
  includeUndescribed: boolean;
  includeImageSet: boolean;
  excludedSeriesIds: Set<string>;
}) {
  const selected: SeriesRow[] = [];
  const pageSize = Math.min(500, Math.max(100, limit * 3));
  let currentOffset = offset;

  while (selected.length < limit) {
    const page = await fetchTargetSeries({
      supabase,
      limit: pageSize,
      offset: currentOffset,
      includeUndescribed,
      includeImageSet,
    });

    if (page.length === 0) {
      break;
    }

    for (const series of page) {
      if (excludedSeriesIds.has(series.id)) {
        continue;
      }

      selected.push(series);
      excludedSeriesIds.add(series.id);

      if (selected.length >= limit) {
        break;
      }
    }

    currentOffset += pageSize;
  }

  return selected;
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

async function fetchSeriesIsbns(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  seriesIds: string[],
) {
  const isbnsBySeriesId = new Map<string, string[]>(
    seriesIds.map((seriesId) => [seriesId, []]),
  );

  if (seriesIds.length === 0) {
    return isbnsBySeriesId;
  }

  for (let index = 0; index < seriesIds.length; index += 200) {
    const chunk = seriesIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("series_items")
      .select("series_id, isbn, display_order")
      .in("series_id", chunk)
      .order("display_order", { ascending: true });

    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      const isbns = isbnsBySeriesId.get(row.series_id);
      const isbn = normalizeIsbn(row.isbn);

      if (isbns && isbn && !isbns.includes(isbn)) {
        isbns.push(isbn);
      }
    }
  }

  return isbnsBySeriesId;
}

async function fetchUsableSummarySources(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  seriesIds: string[],
) {
  const sourcesBySeriesId = new Map<string, SeriesSummarySource[]>(
    seriesIds.map((seriesId) => [seriesId, []]),
  );

  if (seriesIds.length === 0) {
    return sourcesBySeriesId;
  }

  for (let index = 0; index < seriesIds.length; index += 200) {
    const chunk = seriesIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("series_summary_sources")
      .select(
        "id, series_id, url, domain, source_type, title, description, extracted_text, score, status, error_message",
      )
      .in("series_id", chunk)
      .eq("status", "fetched")
      .not("extracted_text", "is", null)
      .order("score", { ascending: false })
      .order("id", { ascending: true });

    if (error) {
      throw error;
    }

    for (const source of (data ?? []) as SeriesSummarySource[]) {
      const sources = sourcesBySeriesId.get(source.series_id);

      if (sources && sources.length < MAX_SOURCES_PER_SERIES) {
        sources.push(source);
      }
    }
  }

  return sourcesBySeriesId;
}

async function fetchSummarySourcesForSeries(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  seriesId: string,
) {
  const { data, error } = await supabase
    .from("series_summary_sources")
    .select(
      "id, series_id, url, domain, source_type, title, description, extracted_text, score, status, error_message",
    )
    .eq("series_id", seriesId)
    .order("score", { ascending: false })
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as SeriesSummarySource[];
}

async function discoverSourceUrls({
  series,
  context,
  isbns,
  provider,
}: {
  series: SeriesRow;
  context: SeriesContext | undefined;
  isbns: string[];
  provider: SourceDiscoveryProvider;
}) {
  if (provider === "none") {
    return {
      directUrls: [],
      searchUrls: [],
      urls: [],
    };
  }

  if (provider === "crawler") {
    return discoverCrawlerSourceUrls(series, context, isbns);
  }

  const title = series.display_title || series.search_title;
  const author = context?.authors[0];
  const publisher = context?.publishers[0];
  const imprint = context?.imprints[0];
  const baseTerms = uniqueStrings([
    title,
    series.search_title,
    author,
    publisher,
    imprint,
  ]).join(" ");
  const siteDomains = preferredSourceDomains(context);
  const queries = [
    ...siteDomains.map((domain) => `${baseTerms} site:${domain}`),
    `${baseTerms} 漫画 公式`,
    `${baseTerms} 漫画 あらすじ`,
  ];
  const urls: string[] = [];

  for (const query of queries) {
    if (urls.length >= MAX_SOURCES_PER_SERIES) {
      break;
    }

    const searchResults = await googleSearch(query);
    urls.push(...searchResults);
  }

  const discoveredUrls = uniqueStrings(urls)
    .map(normalizeUrl)
    .filter((url): url is string => Boolean(url))
    .sort((a, b) => scoreSourceUrl(b) - scoreSourceUrl(a))
    .slice(0, MAX_SOURCES_PER_SERIES);

  return {
    directUrls: [],
    searchUrls: discoveredUrls,
    urls: discoveredUrls,
  };
}

async function discoverCrawlerSourceUrls(
  series: SeriesRow,
  context: SeriesContext | undefined,
  isbns: string[],
) {
  const candidates = inferPublisherCandidates(context, isbns);
  const directUrls = normalizeCrawlerSourceUrls(
    buildDirectCrawlerSourceUrls(isbns, candidates),
  );
  const searchUrls = normalizeCrawlerSourceUrls(
    await crawlPublisherSearchUrls(series, context, isbns),
  );
  const urls = normalizeCrawlerSourceUrls([...directUrls, ...searchUrls]).slice(
    0,
    MAX_SOURCES_PER_SERIES,
  );

  return {
    directUrls,
    searchUrls,
    urls,
  };
}

function normalizeCrawlerSourceUrls(urls: string[]) {
  return uniqueStrings(urls)
    .map(normalizeUrl)
    .filter((url): url is string => Boolean(url))
    .filter((url) => isLikelyCrawlerSourceUrl(url))
    .sort((a, b) => scoreSourceUrl(b) - scoreSourceUrl(a));
}

function buildDirectCrawlerSourceUrls(
  isbns: string[],
  candidates: Set<string>,
) {
  const urls: string[] = [];

  for (const isbn of isbns.slice(0, 3)) {
    const normalized = normalizeIsbn(isbn);
    const isbn13 =
      normalized?.length === 13
        ? normalized
        : normalized
          ? isbn10ToIsbn13(normalized)
          : null;
    const isbn10 = normalized ? isbn13ToIsbn10(normalized) : null;
    const hyphenated = isbn13 ? hyphenateJapaneseIsbn13(isbn13) : null;

    if (isbn13 && candidates.has("square_enix")) {
      urls.push(
        `https://magazine.jp.square-enix.com/top/comics/detail/${isbn13}/`,
      );
    }

    if (isbn10 && candidates.has("akita")) {
      urls.push(`https://www.akitashoten.co.jp/comics/${isbn10}`);
    }

    if (isbn13 && candidates.has("shogakukan")) {
      urls.push(`https://shogakukan-comic.jp/book?isbn=${isbn13}`);
    }

    if (hyphenated && candidates.has("shueisha")) {
      urls.push(
        `https://www.shueisha.co.jp/books/items/contents.html?isbn=${encodeURIComponent(hyphenated)}&mode=1`,
        `https://books.shueisha.co.jp/items/contents.html?isbn=${encodeURIComponent(hyphenated)}`,
        `https://www.s-manga.net/items/contents.html?isbn=${encodeURIComponent(hyphenated)}`,
      );
    }
  }

  return urls;
}

async function crawlPublisherSearchUrls(
  series: SeriesRow,
  context: SeriesContext | undefined,
  isbns: string[],
) {
  const searchQueries = buildCrawlerSearchQueries(series, context, isbns);

  if (searchQueries.length === 0) {
    return [];
  }

  const searchPages = searchQueries
    .flatMap((query) => publisherSearchPages(query, context, isbns))
    .slice(0, MAX_CRAWLER_SEARCH_PAGES_PER_SERIES);
  const urls: string[] = [];

  for (const searchPage of searchPages) {
    try {
      const html = await fetchHtml(searchPage.url);
      const pageLinks = extractCrawlerSearchResultLinks(html, searchPage.url);
      urls.push(
        ...expandCrawlerSourceUrls(pageLinks).filter(
          (url) =>
            searchPage.allowedDomains.some((domain) =>
              domainFromUrl(url).endsWith(domain),
            ) && isLikelyCrawlerSourceUrl(url),
        ),
      );
    } catch (error) {
      console.warn("[Series summary sources] Search page crawl failed.", {
        url: searchPage.url,
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  return urls;
}

function buildCrawlerSearchQueries(
  series: SeriesRow,
  context: SeriesContext | undefined,
  isbns: string[],
) {
  const title = series.display_title || series.search_title;
  const strippedTitle = stripBracketedSubtitle(title);
  const author = context?.authors[0];
  const normalizedIsbns = uniqueStrings(
    isbns.flatMap((isbn) => {
      const normalized = normalizeIsbn(isbn);
      const isbn13 =
        normalized?.length === 13
          ? normalized
          : normalized
            ? isbn10ToIsbn13(normalized)
            : null;
      const isbn10 = normalized ? isbn13ToIsbn10(normalized) : null;

      return [isbn13, isbn10];
    }),
  );

  return uniqueStrings([
    uniqueStrings([title, series.search_title, author]).join(" "),
    uniqueStrings([strippedTitle, author]).join(" "),
    title,
    strippedTitle,
    ...normalizedIsbns.slice(0, 2),
  ]).filter((query) => query.length > 0);
}

function extractCrawlerSearchResultLinks(html: string, baseUrl: string) {
  const links = extractLinks(html, baseUrl);
  const unescapedHtml = decodeHtmlEntities(html).replace(/\\\//g, "/");
  const absoluteUrlPattern = /https?:\/\/[^\s"'<>\\)]+/g;
  let match: RegExpExecArray | null;

  while ((match = absoluteUrlPattern.exec(unescapedHtml))) {
    const normalized = normalizeUrl(match[0] ?? "");

    if (normalized) {
      links.push(normalized);
    }
  }

  return uniqueStrings(links);
}

function expandCrawlerSourceUrls(urls: string[]) {
  const expanded = [...urls];

  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.toLowerCase();
      const productId = parsed.pathname.match(/^\/product\/([^/]+)\/?$/)?.[1];
      const kodanshaMangaIpId = parsed.pathname.match(
        /^\/mangaip\/database\/([^/]+)\/?$/,
      )?.[1];

      if (domain === "www.kadokawa.co.jp" && productId) {
        expanded.push(`https://store.kadokawa.co.jp/shop/g/g${productId}/`);
      }

      if (domain === "cstation.kodansha.co.jp" && kodanshaMangaIpId) {
        expanded.push(
          `https://www.kodansha.co.jp/comic/products/${kodanshaMangaIpId}`,
        );
      }
    } catch {
      // Ignore malformed crawler result links.
    }
  }

  return uniqueStrings(expanded);
}

function publisherSearchPages(
  query: string,
  context: SeriesContext | undefined,
  isbns: string[],
) {
  const encoded = encodeURIComponent(query);
  const candidates = inferPublisherCandidates(context, isbns);
  const pages = [
    {
      id: "kodansha",
      url: `https://www.kodansha.co.jp/search?keyword=${encoded}`,
      allowedDomains: ["kodansha.co.jp", "shonenmagazine.com"],
    },
    {
      id: "kodansha",
      url: `https://www.kodansha.co.jp/search?q=${encoded}`,
      allowedDomains: ["kodansha.co.jp", "shonenmagazine.com"],
    },
    {
      id: "kodansha",
      url: `https://cstation.kodansha.co.jp/search?keyword=${encoded}`,
      allowedDomains: ["kodansha.co.jp", "cstation.kodansha.co.jp"],
    },
    {
      id: "kadokawa",
      url: `https://www.kadokawa.co.jp/search?kw=${encoded}`,
      allowedDomains: ["kadokawa.co.jp", "dragonage-comic.com", "comic-alive.jp"],
    },
    {
      id: "kadokawa",
      url: `https://www.kadokawa.co.jp/search?keyword=${encoded}`,
      allowedDomains: ["kadokawa.co.jp", "dragonage-comic.com", "comic-alive.jp"],
    },
    {
      id: "kadokawa",
      url: `https://store.kadokawa.co.jp/shop/goods/search.aspx?keyword=${encoded}`,
      allowedDomains: ["kadokawa.co.jp", "store.kadokawa.co.jp"],
    },
    {
      id: "akita",
      url: `https://www.akitashoten.co.jp/search?q=${encoded}`,
      allowedDomains: ["akitashoten.co.jp", "youngchampion.jp"],
    },
    {
      id: "square_enix",
      url: `https://magazine.jp.square-enix.com/search/?q=${encoded}`,
      allowedDomains: ["magazine.jp.square-enix.com", "ganganonline.com"],
    },
    {
      id: "shogakukan",
      url: `https://shogakukan-comic.jp/search?q=${encoded}`,
      allowedDomains: ["shogakukan-comic.jp", "shogakukan.co.jp"],
    },
    {
      id: "shueisha",
      url: `https://www.shueisha.co.jp/search?keyword=${encoded}`,
      allowedDomains: ["shueisha.co.jp", "s-manga.net", "shonenjumpplus.com"],
    },
    {
      id: "ichijinsha",
      url: `https://www.ichijinsha.co.jp/?s=${encoded}`,
      allowedDomains: ["ichijinsha.co.jp"],
    },
  ];

  return pages.filter((page) => candidates.has(page.id));
}

function isLikelyCrawlerSourceUrl(url: string) {
  const domain = domainFromUrl(url);
  let parsed: URL;

  if (!domain) {
    return false;
  }

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const path = parsed.pathname;

  if (domain === "shogakukan-comic.jp") {
    return (
      path === "/book" &&
      (parsed.searchParams.has("isbn") || parsed.searchParams.has("jdcn"))
    );
  }

  if (
    domain === "www.kodansha.co.jp" &&
    /^\/(comic\/products|titles)\/[^/]+\/?$/.test(path)
  ) {
    return true;
  }

  if (
    domain === "cstation.kodansha.co.jp" &&
    /^\/mangaip\/database\/[^/]+\/?$/.test(path)
  ) {
    return true;
  }

  if (domain === "www.kadokawa.co.jp" && /^\/product\/[^/]+\/?$/.test(path)) {
    return true;
  }

  if (domain === "store.kadokawa.co.jp" && /^\/shop\/g\/g[^/]+\/?$/.test(path)) {
    return true;
  }

  if (
    /dragonage-comic\.com|comic-alive\.jp/.test(domain) &&
    /^\/product\/.+/.test(path)
  ) {
    return true;
  }

  if (
    domain === "www.akitashoten.co.jp" &&
    /^\/(series|comics)\/[^/]+\/?$/.test(path)
  ) {
    return true;
  }

  if (domain === "youngchampion.jp" && /^\/series\/[^/]+\/?$/.test(path)) {
    return true;
  }

  if (
    domain === "magazine.jp.square-enix.com" &&
    (/^\/top\/comics\/detail\/[^/]+\/?$/.test(path) ||
      /^\/[^/]+\/series\/[^/]+\/?$/.test(path))
  ) {
    return true;
  }

  if (
    /^(www\.)?shueisha\.co\.jp$/.test(domain) &&
    path === "/books/items/contents.html" &&
    (parsed.searchParams.has("isbn") || parsed.searchParams.has("jdcn"))
  ) {
    return true;
  }

  if (
    (domain === "books.shueisha.co.jp" || domain === "www.s-manga.net") &&
    /^\/items\/contents(_amp)?\.html$/.test(path) &&
    (parsed.searchParams.has("isbn") || parsed.searchParams.has("jdcn"))
  ) {
    return true;
  }

  if (domain === "shonenjumpplus.com" && /^\/volume\/[^/]+\/?$/.test(path)) {
    return true;
  }

  if (domain === "www.shonenjump.com" && /^\/j\/rensai\/.+\.html$/.test(path)) {
    return true;
  }

  if (
    domain === "www.ichijinsha.co.jp" &&
    /^\/(yurihime\/title|stories\/comic-rex)\/.+/.test(path)
  ) {
    return true;
  }

  if (domain === "www.shinchosha.co.jp" && /^\/book\/[^/]+\/?$/.test(path)) {
    return true;
  }

  if (domain === "www.shonengahosha.co.jp" && path === "/book_Info.php") {
    return parsed.searchParams.has("id");
  }

  return false;
}

function isGenericCrawlerSourceUrl(url: string) {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "") || "/";

    if (
      domain === "shogakukan-comic.jp" &&
      ["/", "/news", "/release", "/new-release"].includes(path)
    ) {
      return true;
    }

    if (/\/(search|news|release|new-release)\/?$/.test(path)) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function inferPublisherCandidates(
  context: SeriesContext | undefined,
  isbns: string[],
) {
  const contextCandidates = new Set<string>();
  const joined = normalizeComparableText(
    [
      ...(context?.publishers ?? []),
      ...(context?.imprints ?? []),
    ].join(" "),
  );

  if (/kodansha|講談社|モーニング|ヤンマガ|マガジン/.test(joined)) {
    contextCandidates.add("kodansha");
  }

  if (/kadokawa|角川|電撃|ドラゴン|アライブ|フラッパー/.test(joined)) {
    contextCandidates.add("kadokawa");
  }

  if (/akitashoten|秋田書店|チャンピオン/.test(joined)) {
    contextCandidates.add("akita");
  }

  if (/squareenix|スクウェアエニックス|スクエニ|ガンガン|joker/.test(joined)) {
    contextCandidates.add("square_enix");
  }

  if (/shogakukan|小学館|サンデー|ビッグコミック|スピリッツ|ちゃお/.test(joined)) {
    contextCandidates.add("shogakukan");
  }

  if (/shueisha|集英社|ジャンプ|マーガレット|りぼん|ヤングジャンプ/.test(joined)) {
    contextCandidates.add("shueisha");
  }

  if (/ichijinsha|一迅社|百合姫|comicrex/.test(joined)) {
    contextCandidates.add("ichijinsha");
  }

  const strongIsbnCandidates = new Set<string>();
  let hasAmbiguous475Prefix = false;

  for (const isbn of isbns) {
    const normalized = normalizeIsbn(isbn);

    if (!normalized) {
      continue;
    }

    if (normalized.startsWith("978406") || normalized.startsWith("406")) {
      strongIsbnCandidates.add("kodansha");
    }

    if (normalized.startsWith("978404") || normalized.startsWith("404")) {
      strongIsbnCandidates.add("kadokawa");
    }

    if (normalized.startsWith("978425") || normalized.startsWith("425")) {
      strongIsbnCandidates.add("akita");
    }

    if (normalized.startsWith("978475") || normalized.startsWith("475")) {
      hasAmbiguous475Prefix = true;
    }

    if (normalized.startsWith("978409") || normalized.startsWith("409")) {
      strongIsbnCandidates.add("shogakukan");
    }

    if (normalized.startsWith("978408") || normalized.startsWith("408")) {
      strongIsbnCandidates.add("shueisha");
    }
  }

  if (strongIsbnCandidates.size > 0) {
    return strongIsbnCandidates;
  }

  const candidates = new Set(contextCandidates);

  if (hasAmbiguous475Prefix) {
    const matching475Candidates = [...contextCandidates].filter(
      (candidate) => candidate === "square_enix" || candidate === "ichijinsha",
    );

    if (matching475Candidates.length > 0) {
      return new Set(matching475Candidates);
    }

    if (contextCandidates.size === 0) {
      candidates.add("square_enix");
      candidates.add("ichijinsha");
    }
  }

  if (candidates.size === 0) {
    candidates.add("kodansha");
    candidates.add("kadokawa");
    candidates.add("akita");
    candidates.add("square_enix");
    candidates.add("shogakukan");
    candidates.add("shueisha");
    candidates.add("ichijinsha");
  }

  return candidates;
}

function preferredSourceDomains(context: SeriesContext | undefined) {
  const domains = new Set<string>();
  const joined = [
    ...(context?.publishers ?? []),
    ...(context?.imprints ?? []),
  ].join(" ");

  if (joined.includes("講談社")) {
    domains.add("www.kodansha.co.jp");
    domains.add("pocket.shonenmagazine.com");
  }

  if (joined.includes("KADOKAWA") || joined.includes("角川")) {
    domains.add("www.kadokawa.co.jp");
    domains.add("comic-walker.com");
    domains.add("dragonage-comic.com");
  }

  if (joined.includes("秋田書店")) {
    domains.add("www.akitashoten.co.jp");
  }

  if (joined.includes("小学館")) {
    domains.add("www.shogakukan.co.jp");
    domains.add("shogakukan-comic.jp");
    domains.add("e-comi.shogakukan.co.jp");
  }

  if (joined.includes("集英社")) {
    domains.add("www.shueisha.co.jp");
    domains.add("books.shueisha.co.jp");
    domains.add("shonenjumpplus.com");
  }

  if (joined.includes("スクウェア") || joined.includes("スクエニ")) {
    domains.add("magazine.jp.square-enix.com");
    domains.add("www.ganganonline.com");
  }

  for (const domain of [
    "mangapedia.com",
    "www.hanmoto.com",
    "ndlsearch.ndl.go.jp",
  ]) {
    domains.add(domain);
  }

  return [...domains].slice(0, 8);
}

async function googleSearch(query: string) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    return [];
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", searchEngineId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "5");
  url.searchParams.set("lr", "lang_ja");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Google Search failed: ${response.status} ${await response.text()}`,
    );
  }

  const body = (await response.json()) as {
    items?: Array<{ link?: string }>;
  };

  return (body.items ?? [])
    .map((item) => item.link)
    .filter((link): link is string => Boolean(link));
}

function hasGoogleSearchConfig() {
  return Boolean(
    process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID,
  );
}

function getSourceDiscoveryProvider(
  searchRequested: boolean,
): SourceDiscoveryProvider {
  if (!searchRequested) {
    return "none";
  }

  const configured = process.env.SOURCE_SEARCH_PROVIDER?.toLowerCase();

  if (configured === "none") {
    return "none";
  }

  if (configured === "crawler" || configured === "crawl") {
    return "crawler";
  }

  if (configured === "google" || configured === "google_custom_search") {
    return hasGoogleSearchConfig() ? "google" : "none";
  }

  return "crawler";
}

function requiredSourceDiscoverySettings(provider: SourceDiscoveryProvider) {
  if (provider === "google") {
    return hasGoogleSearchConfig()
      ? []
      : ["GOOGLE_SEARCH_API_KEY", "GOOGLE_SEARCH_ENGINE_ID"];
  }

  return [];
}

async function fetchAndStoreSummarySource({
  supabase,
  series,
  context,
  isbns,
  seriesId,
  url,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  series?: SeriesRow;
  context?: SeriesContext;
  isbns?: string[];
  seriesId: string;
  url: string;
}) {
  try {
    const fetched = await fetchSourceContent(url);
    const matchScore = series
      ? scoreFetchedSourceMatch({
          url,
          fetched,
          series,
          context,
          isbns: isbns ?? [],
        })
      : scoreSourceUrl(url);

    if (matchScore < MIN_ACCEPTED_SOURCE_SCORE) {
      return upsertSummarySource({
        supabase,
        seriesId,
        url,
        status: "ignored",
        title: fetched.title,
        description: fetched.description,
        extractedText: fetched.text,
        score: matchScore,
        errorMessage: `Source match score is too low: ${matchScore}`,
      });
    }

    return upsertSummarySource({
      supabase,
      seriesId,
      url,
      status: "fetched",
      title: fetched.title,
      description: fetched.description,
      extractedText: fetched.text,
      score: matchScore,
    });
  } catch (error) {
    return upsertSummarySource({
      supabase,
      seriesId,
      url,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error.",
    });
  }
}

async function upsertSummarySource({
  supabase,
  seriesId,
  url,
  status,
  title = null,
  description = null,
  extractedText = null,
  errorMessage = null,
  score,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  seriesId: string;
  url: string;
  status: "pending" | "fetched" | "failed" | "ignored";
  title?: string | null;
  description?: string | null;
  extractedText?: string | null;
  errorMessage?: string | null;
  score?: number;
}) {
  const domain = domainFromUrl(url);
  const sourceType = classifySourceUrl(url);
  const { data, error } = await supabase
    .from("series_summary_sources")
    .upsert(
      {
        series_id: seriesId,
        url,
        domain,
        source_type: sourceType,
        title,
        description,
        extracted_text: extractedText,
        score: score ?? scoreSourceUrl(url),
        status,
        error_message: errorMessage,
        fetched_at: status === "fetched" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "series_id,url" },
    )
    .select(
      "id, series_id, url, domain, source_type, title, description, extracted_text, score, status, error_message",
    )
    .single();

  if (error) {
    throw error;
  }

  return data as SeriesSummarySource;
}

async function fetchSourceContent(url: string) {
  const html = await fetchHtml(url);
  const title = decodeHtmlEntities(extractTagContent(html, "title") ?? "");
  const description = decodeHtmlEntities(
    extractMetaContent(html, "description") ??
      extractMetaPropertyContent(html, "og:description") ??
      "",
  );
  const text = extractReadableText(html);

  if (text.length < 80 && !description) {
    throw new Error("Extracted text is too short.");
  }

  return {
    title: truncateText(title, 300),
    description: truncateText(description, 1000),
    text: truncateText(text || description, MAX_SOURCE_TEXT_LENGTH),
  };
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (compatible; MangaReleaseSummaryBot/1.0; +https://manga-release-pwa.vercel.app)",
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("text/html")) {
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }

  return response.text();
}

function scoreFetchedSourceMatch({
  url,
  fetched,
  series,
  context,
  isbns,
}: {
  url: string;
  fetched: { title: string; description: string; text: string };
  series: SeriesRow;
  context?: SeriesContext;
  isbns: string[];
}) {
  const sourceText = normalizeComparableText(
    [fetched.title, fetched.description, fetched.text].join(" "),
  );
  const titleTerms = uniqueStrings([
    series.display_title,
    series.search_title,
    stripBracketedSubtitle(series.display_title),
  ])
    .map(normalizeComparableText)
    .filter((value) => value.length >= 2);
  const authorTerms = (context?.authors ?? [])
    .map(normalizeComparableText)
    .filter((value) => value.length >= 2);
  const publisherTerms = [
    ...(context?.publishers ?? []),
    ...(context?.imprints ?? []),
  ]
    .map(normalizeComparableText)
    .filter((value) => value.length >= 2);
  const isbnTerms = uniqueStrings(
    isbns.flatMap((isbn) => {
      const normalized = normalizeIsbn(isbn);
      const isbn10 = normalized ? isbn13ToIsbn10(normalized) : null;
      const hyphenated = normalized ? hyphenateJapaneseIsbn13(normalized) : null;

      return [normalized, isbn10, hyphenated];
    }),
  ).map(normalizeComparableText);
  let score = scoreSourceUrl(url);

  if (titleTerms.some((title) => sourceText.includes(title))) {
    score += 40;
  }

  if (authorTerms.length > 0 && authorTerms.some((author) => sourceText.includes(author))) {
    score += 20;
  }

  if (isbnTerms.length > 0 && isbnTerms.some((isbn) => sourceText.includes(isbn))) {
    score += 25;
  }

  if (
    publisherTerms.length > 0 &&
    publisherTerms.some((publisher) => sourceText.includes(publisher))
  ) {
    score += 10;
  }

  if (isLikelyCrawlerSourceUrl(url)) {
    score += 10;
  }

  if (isGenericCrawlerSourceUrl(url)) {
    score -= 60;
  }

  if (
    titleTerms.length > 0 &&
    !titleTerms.some((title) => sourceText.includes(title)) &&
    !isbnTerms.some((isbn) => sourceText.includes(isbn))
  ) {
    score -= 40;
  }

  return Math.max(0, score);
}

function extractReadableText(html: string) {
  const mainHtml = extractLikelyMainHtml(html);
  return decodeHtmlEntities(
    mainHtml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|p|div|li|h[1-6]|section|article)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function extractLikelyMainHtml(html: string) {
  const patterns = [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<body\b[^>]*>([\s\S]*?)<\/body>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return html;
}

function extractTagContent(html: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  return html.match(pattern)?.[1]?.trim() ?? null;
}

function extractMetaContent(html: string, name: string) {
  const pattern = new RegExp(
    `<meta[^>]+name=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    "i",
  );
  return html.match(pattern)?.[1]?.trim() ?? null;
}

function extractMetaPropertyContent(html: string, property: string) {
  const pattern = new RegExp(
    `<meta[^>]+property=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    "i",
  );
  return html.match(pattern)?.[1]?.trim() ?? null;
}

function extractLinks(html: string, baseUrl: string) {
  const links: string[] = [];
  const pattern = /<a\b[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const href = decodeHtmlEntities(match[1] ?? "");

    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    ) {
      continue;
    }

    try {
      const url = new URL(href, baseUrl);
      const normalized = normalizeUrl(url.toString());

      if (normalized) {
        links.push(normalized);
      }
    } catch {
      // Ignore malformed page links.
    }
  }

  return uniqueStrings(links);
}

function classifySourceUrl(url: string): SourceType {
  const domain = domainFromUrl(url);

  if (
    /kodansha|kadokawa|akitashoten|shogakukan|shueisha|square-enix|shinchosha|ichijinsha|shonengahosha|shonenjump|shonenmagazine|yanmaga|dragonage|s-manga|ganganonline/.test(
      domain,
    )
  ) {
    return "publisher_official";
  }

  if (/ndlsearch|hanmoto/.test(domain)) {
    return "bibliographic";
  }

  if (
    /sony|line|bookwalker|cmoa|docomo|rakuten|booklive|google|kinokuniya|mangazenkan|bookpass/.test(
      domain,
    )
  ) {
    return "ebook_store";
  }

  if (/mangapedia|mangaseek|wikipedia|alu/.test(domain)) {
    return "reference_database";
  }

  if (/official|anime|classroom-crisis|ai-no-idenshi|btooom|lovechuchu/.test(domain)) {
    return "official_site";
  }

  return "other";
}

function scoreSourceUrl(url: string) {
  const sourceType = classifySourceUrl(url);
  const baseScores: Record<SourceType, number> = {
    publisher_official: 100,
    official_site: 85,
    bibliographic: 75,
    ebook_store: 60,
    reference_database: 45,
    other: 20,
  };

  return baseScores[sourceType];
}

function formatSourceContext(sources: SeriesSummarySource[]) {
  let remaining = MAX_SOURCE_CONTEXT_LENGTH;
  const blocks = [];

  for (const source of sources) {
    if (remaining <= 0) {
      break;
    }

    const text = truncateText(
      [
        source.title ? `title: ${source.title}` : null,
        source.description ? `description: ${source.description}` : null,
        source.extracted_text ? `text: ${source.extracted_text}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      Math.min(MAX_SOURCE_TEXT_LENGTH, remaining),
    );

    if (!text) {
      continue;
    }

    const block = [
      `url: ${source.url}`,
      `source_type: ${source.source_type}`,
      text,
    ].join("\n");

    blocks.push(block);
    remaining -= block.length;
  }

  return blocks.length ? blocks.join("\n\n---\n\n") : "なし";
}

function normalizeUrl(url: string) {
  try {
    const parsed = new URL(url.trim());

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeIsbn(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/[^0-9X]/gi, "").toUpperCase();

  if (digits.length === 10 || digits.length === 13) {
    return digits;
  }

  return null;
}

function normalizeComparableText(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s"'`´’‘“”・･\-_‐-―〜～~!！?？.,，、。:：;；()[\]{}<>《》〈〉「」『』【】]/g, "")
    .trim();
}

function stripBracketedSubtitle(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[「『].*?[」』]/g, "")
    .trim();
}

function isbn13ToIsbn10(isbn: string) {
  const normalized = normalizeIsbn(isbn);

  if (!normalized) {
    return null;
  }

  if (normalized.length === 10) {
    return normalized;
  }

  if (!normalized.startsWith("978")) {
    return null;
  }

  const body = normalized.slice(3, 12);
  let sum = 0;

  for (let index = 0; index < body.length; index += 1) {
    sum += Number(body[index]) * (10 - index);
  }

  const remainder = 11 - (sum % 11);
  const checkDigit =
    remainder === 10 ? "X" : remainder === 11 ? "0" : String(remainder);

  return `${body}${checkDigit}`;
}

function isbn10ToIsbn13(isbn: string) {
  const normalized = normalizeIsbn(isbn);

  if (!normalized) {
    return null;
  }

  if (normalized.length === 13) {
    return normalized;
  }

  const body = `978${normalized.slice(0, 9)}`;
  let sum = 0;

  for (let index = 0; index < body.length; index += 1) {
    sum += Number(body[index]) * (index % 2 === 0 ? 1 : 3);
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  return `${body}${checkDigit}`;
}

function hyphenateJapaneseIsbn13(isbn: string) {
  const normalized = normalizeIsbn(isbn);

  if (!normalized || normalized.length !== 13 || !normalized.startsWith("9784")) {
    return null;
  }

  return [
    normalized.slice(0, 3),
    normalized.slice(3, 4),
    normalized.slice(4, 6),
    normalized.slice(6, 12),
    normalized.slice(12),
  ].join("-");
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createSeriesSummary({
  series,
  context,
  sources,
  model,
  webSearchToolType,
  allowWebSearch,
  retryForTooShort = false,
}: {
  series: SeriesRow;
  context: SeriesContext | undefined;
  sources: SeriesSummarySource[];
  model: string;
  webSearchToolType: string;
  allowWebSearch: boolean;
  retryForTooShort?: boolean;
}) {
  if (sources.length === 0) {
    if (allowWebSearch) {
      return createSeriesSummaryWithWebSearch({
        series,
        context,
        sources,
        model,
        webSearchToolType,
        allowWebSearch,
        retryForTooShort,
      });
    }

    return {
      id: series.id,
      title: series.display_title,
      summary: "",
      confidence: "low",
      needs_review: true,
      notes: "保存済みの情報ソースがありません。",
      source_urls: [],
    } satisfies SummaryResult;
  }

  const sourceContext = formatSourceContext(sources);
  const body = {
    model,
    input: [
      {
        role: "system",
        content: [
          "あなたは漫画紹介文を作る編集者です。",
          "Web検索は使わず、ユーザーから渡された参考情報だけを使ってください。",
          "作品紹介ページに掲載できるような自然なあらすじを作成してください。",
          "日本語で作成してください。",
          "400字程度で作成してください。",
          "3〜4段落に分け、段落間に空行を入れず、改行は1つだけにしてください。",
          "漫画の作品名は必ず『』で囲んでください。",
          "冒頭のあらすじ要約は1行だけで書き、その直後に改行して次の段落へ進んでください。",
          "作品名、作者、ジャンル感、主人公、舞台、導入、見どころを自然に含めてください。",
          "結末や重大なネタバレは避けてください。",
          "参考情報にない設定や固有名詞を勝手に追加しないでください。",
          "参考情報をそのままコピーせず、必ず言い換えて再構成してください。",
          "あらすじ本文には、引用文、引用符、出典名、URL、参考文献のような記述を含めないでください。",
          "文体は漫画紹介文らしく、少しドラマチックにしてください。",
          "ただし煽りすぎず、落ち着いた紹介文にしてください。",
          "「〇〇が見どころ」「読み応えのある一作」のような主観的な評価表現は使わず、確認できる内容に基づいて魅力を説明してください。",
          "短い文を連続して並べず、文の長短や接続に緩急をつけて、自然な流れのある文章にしてください。",
          "ですます調を使わないでください。",
          "文末を「だ」「である」「となる」で終わらせないでください。",
          "「〜していく」「〜へ向かう」「〜が描かれる」「〜に巻き込まれていく」などを自然に使ってください。",
          "不明な情報は補完しないでください。",
          "同名作品などで特定できない場合や情報不足の場合は needs_review=true にしてください。",
          "確認に使った主要なURLは、渡されたsource_materials内のurlだけからsource_urlsに入れてください。",
          retryForTooShort
            ? "前回の出力が短すぎたため、情報を補完せず、確認できた範囲の導入や展開を厚めにして400字程度まで自然に広げてください。"
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
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
          `source_materials:\n${sourceContext}`,
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
  let response;

  try {
    response = await openAIRequest("/responses", {
      method: "POST",
      json: body,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (model !== DEFAULT_MODEL && shouldFallbackToDefaultModel(message)) {
      return createSeriesSummary({
        series,
        context,
        sources,
        model: DEFAULT_MODEL,
        webSearchToolType,
        allowWebSearch,
        retryForTooShort,
      });
    }

    throw error;
  }

  const outputText = extractOutputText(response);

  if (!outputText) {
    throw new Error("No output text found.");
  }

  return normalizeSummaryResult(JSON.parse(outputText) as SummaryResult);
}

async function createSeriesSummaryWithWebSearch({
  series,
  context,
  sources,
  model,
  webSearchToolType,
  allowWebSearch,
  retryForTooShort = false,
}: {
  series: SeriesRow;
  context: SeriesContext | undefined;
  sources: SeriesSummarySource[];
  model: string;
  webSearchToolType: string;
  allowWebSearch: boolean;
  retryForTooShort?: boolean;
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
          "作品紹介ページに掲載できるような自然なあらすじを作成してください。",
          "日本語で作成してください。",
          "400字程度で作成してください。",
          "3〜4段落に分け、段落間に空行を入れず、改行は1つだけにしてください。",
          "漫画の作品名は必ず『』で囲んでください。",
          "冒頭のあらすじ要約は1行だけで書き、その直後に改行して次の段落へ進んでください。",
          "作品名、作者、ジャンル感、主人公、舞台、導入、見どころを自然に含めてください。",
          "結末や重大なネタバレは避けてください。",
          "参考情報にない設定や固有名詞を勝手に追加しないでください。",
          "参考情報をそのままコピーせず、必ず言い換えて再構成してください。",
          "あらすじ本文には、引用文、引用符、出典名、URL、参考文献のような記述を含めないでください。",
          "文体は漫画紹介文らしく、少しドラマチックにしてください。",
          "ただし煽りすぎず、落ち着いた紹介文にしてください。",
          "「〇〇が見どころ」「読み応えのある一作」のような主観的な評価表現は使わず、確認できる内容に基づいて魅力を説明してください。",
          "短い文を連続して並べず、文の長短や接続に緩急をつけて、自然な流れのある文章にしてください。",
          "ですます調を使わないでください。",
          "文末を「だ」「である」「となる」で終わらせないでください。",
          "「〜していく」「〜へ向かう」「〜が描かれる」「〜に巻き込まれていく」などを自然に使ってください。",
          "文体は次の型を参考にしてください。ただし、未確認の情報は入れず、本文内に丸括弧の伏せ字やテンプレート記号を残さないでください。",
          "『作品名』は、舞台や題材を背景に、主人公が変化していく姿を描く、作者名によるジャンル漫画。",
          "主人公は、物語開始時点の立場や日常の中で暮らしていた人物。ある日、出会いや事件をきっかけに、平穏だった日常が大きく変わっていく。",
          "やがて主人公は、仲間との出会い、敵との衝突、過去の秘密、避けられない選択など、確認できる範囲の要素に向き合うことになる。",
          "複数の要素が交錯する中で、主人公は少しずつ成長し、自分の進むべき道を見つけていく。",
          "最後は、作品の魅力と展開の特色が合わさった物語として締めてください。",
          "最後の段落は、その作品の魅力やジャンル感をまとめる締めにしてください。",
          "不明な情報は補完しないでください。",
          "同名作品などで特定できない場合や情報不足の場合は needs_review=true にしてください。",
          "確認に使った主要なURLを source_urls に入れてください。",
          retryForTooShort
            ? "前回の出力が短すぎたため、情報を補完せず、確認できた範囲の見どころや導入を厚めにして400字程度まで自然に広げてください。"
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
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
  let response;

  try {
    response = await openAIRequest("/responses", {
      method: "POST",
      json: body,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (model !== DEFAULT_MODEL && shouldFallbackToDefaultModel(message)) {
      return createSeriesSummaryWithWebSearch({
        series,
        context,
        sources,
        model: DEFAULT_MODEL,
        webSearchToolType,
        allowWebSearch,
        retryForTooShort,
      });
    }

    throw error;
  }
  const outputText = extractOutputText(response);

  if (!outputText) {
    throw new Error("No output text found.");
  }

  return normalizeSummaryResult(JSON.parse(outputText) as SummaryResult);
}

function shouldFallbackToDefaultModel(errorMessage: string) {
  return (
    errorMessage.includes("limited preview") ||
    errorMessage.includes("not available on this account") ||
    errorMessage.includes("model_not_found")
  );
}

function normalizeSummaryResult(summary: SummaryResult) {
  return {
    ...summary,
    summary: removeBlankLines(summary.summary),
  };
}

function removeBlankLines(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
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
