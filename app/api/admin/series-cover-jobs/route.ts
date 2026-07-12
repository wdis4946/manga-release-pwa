import {
  SERIES_COVERS_BUCKET,
  createSeriesCoverUrl,
} from "@/lib/admin/series-cover-url";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
export const runtime = "nodejs";

const MAX_LIMIT = 20;
const MAX_IMAGE_SIZE = 6 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

type SeriesRow = {
  id: string;
  display_title: string;
  search_title: string;
  representative_image_path: string | null;
};

type SeriesContext = {
  authors: string[];
  publishers: string[];
  imprints: string[];
};

type OfficialSource = {
  series_id: string;
  url: string;
  score: number;
};

type ImageCandidate = {
  url: string;
  score: number;
  reason: string;
};

type CoverJob = {
  id: string;
  series_id: string;
  status: string;
  attempts: number;
  max_attempts: number;
};

export async function POST(request: Request) {
  const authError = authorizeCronRequest(request);

  if (authError) {
    return authError;
  }

  const mode = new URL(request.url).searchParams.get("mode");

  try {
    if (mode === "enqueue") {
      return Response.json(await enqueueSeriesCoverJobs(request));
    }

    if (mode === "run") {
      return Response.json(await runSeriesCoverJobs(request));
    }

    if (mode === "status") {
      return Response.json(await getSeriesCoverJobStatus());
    }

    return Response.json(
      { ok: false, error: "mode must be enqueue, run, or status." },
      { status: 400 },
    );
  } catch (error) {
    console.error("[Series cover jobs] Failed.", error);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    );
  }
}

async function enqueueSeriesCoverJobs(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    offset?: number;
    includeImageSet?: boolean;
    maxAttempts?: number;
  };
  const limit = clampPositiveInteger(body.limit ?? 100, 5000);
  const offset = clampNonNegativeInteger(body.offset ?? 0);
  const maxAttempts = clampPositiveInteger(body.maxAttempts ?? 1, 10);
  const supabase = createSupabaseAdminClient();
  let insertedCount = 0;
  let targetCount = 0;
  let currentOffset = offset;

  for (let page = 0; page < 20 && insertedCount < limit; page += 1) {
    const seriesRows = await fetchTargetSeries({
      supabase,
      limit: Math.min(Math.max((limit - insertedCount) * 2, 50), 500),
      offset: currentOffset,
      includeImageSet: body.includeImageSet === true,
    });

    if (seriesRows.length === 0) {
      break;
    }

    targetCount += seriesRows.length;
    currentOffset += seriesRows.length;

    const now = new Date().toISOString();
    const rows = seriesRows.slice(0, limit - insertedCount).map((series) => ({
      series_id: series.id,
      status: "pending",
      max_attempts: maxAttempts,
      updated_at: now,
    }));
    const { data, error } = await supabase
      .from("series_cover_jobs")
      .upsert(rows, {
        onConflict: "series_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) {
      throw error;
    }

    insertedCount += data?.length ?? 0;
  }

  return {
    ok: true,
    mode: "enqueue",
    limit,
    offset,
    includeImageSet: body.includeImageSet === true,
    targetCount,
    insertedCount,
  };
}

async function runSeriesCoverJobs(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    dryRun?: boolean;
  };
  const limit = clampPositiveInteger(body.limit ?? 5, MAX_LIMIT);
  const dryRun = body.dryRun === true;
  const supabase = createSupabaseAdminClient();
  const jobs = await claimPendingCoverJobs(supabase, limit);
  const seriesRows = await fetchSeriesRowsByIds(
    supabase,
    jobs.map((job) => job.series_id),
  );
  const seriesById = new Map(seriesRows.map((series) => [series.id, series]));
  const contexts = await fetchSeriesContext(
    supabase,
    seriesRows.map((series) => series.id),
  );
  const isbnsBySeriesId = await fetchSeriesIsbns(
    supabase,
    seriesRows.map((series) => series.id),
  );
  const officialSources = await fetchOfficialSources(
    supabase,
    seriesRows.map((series) => series.id),
  );
  const results = [];
  let updatedCount = 0;
  let failedCount = 0;

  for (const job of jobs) {
    const series = seriesById.get(job.series_id);

    if (!series) {
      await markCoverJobFailed({
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

    if (series.representative_image_path) {
      await markCoverJobCompleted({
        supabase,
        jobId: job.id,
        result: {
          status: "skipped",
          reason: "representative_image_path is already set.",
          representativeImagePath: series.representative_image_path,
        },
      });
      results.push({
        jobId: job.id,
        seriesId: series.id,
        title: series.display_title,
        status: "skipped",
        reason: "representative_image_path is already set.",
      });
      continue;
    }

    const context = contexts.get(series.id);
    const isbns = isbnsBySeriesId.get(series.id) ?? [];

    try {
      const sourceUrls = await collectOfficialPageUrls({
        series,
        context,
        isbns,
        existingSources: officialSources.get(series.id) ?? [],
      });

      if (sourceUrls.length === 0) {
        if (dryRun) {
          await resetCoverJobPending({ supabase, job });
        } else {
          await markCoverJobFailed({
            supabase,
            job,
            errorMessage: "No official page URL was found.",
          });
        }
        failedCount += 1;
        results.push({
          jobId: job.id,
          seriesId: series.id,
          title: series.display_title,
          status: "failed",
          error: "No official page URL was found.",
        });
        continue;
      }

      const cover = await findCoverImageFromOfficialPages({
        series,
        sourceUrls,
        isbns,
      });

      if (!cover) {
        if (dryRun) {
          await resetCoverJobPending({
            supabase,
            job,
            result: { status: "dry_run_failed", sourceUrls },
          });
        } else {
          await markCoverJobFailed({
            supabase,
            job,
            errorMessage: "No usable cover image was found.",
            result: { sourceUrls },
          });
        }
        failedCount += 1;
        results.push({
          jobId: job.id,
          seriesId: series.id,
          title: series.display_title,
          status: "failed",
          sourceUrls,
          error: "No usable cover image was found.",
        });
        continue;
      }

      if (dryRun) {
        await resetCoverJobPending({
          supabase,
          job,
          result: {
            status: "dry_run",
            sourceUrl: cover.sourceUrl,
            imageUrl: cover.imageUrl,
            score: cover.score,
          },
        });
        results.push({
          jobId: job.id,
          seriesId: series.id,
          title: series.display_title,
          status: "dry_run",
          sourceUrl: cover.sourceUrl,
          imageUrl: cover.imageUrl,
          score: cover.score,
        });
        continue;
      }

      const uploaded = await uploadSeriesCoverFromUrl({
        supabase,
        series,
        imageUrl: cover.imageUrl,
      });
      await markCoverJobCompleted({
        supabase,
        jobId: job.id,
        result: {
          status: "updated",
          sourceUrl: cover.sourceUrl,
          imageUrl: cover.imageUrl,
          score: cover.score,
          representativeImagePath: uploaded.path,
        },
      });
      updatedCount += 1;
      results.push({
        jobId: job.id,
        seriesId: series.id,
        title: series.display_title,
        status: "updated",
        sourceUrl: cover.sourceUrl,
        imageUrl: cover.imageUrl,
        score: cover.score,
        representativeImagePath: uploaded.path,
        representativeImageUrl: uploaded.url,
      });
    } catch (error) {
      if (dryRun) {
        await resetCoverJobPending({ supabase, job });
      } else {
        await markCoverJobFailed({
          supabase,
          job,
          errorMessage: error instanceof Error ? error.message : "Unknown error.",
        });
      }
      failedCount += 1;
      results.push({
        jobId: job.id,
        seriesId: series.id,
        title: series.display_title,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }

  return {
    ok: true,
    mode: "run",
    limit,
    dryRun,
    targetCount: jobs.length,
    claimedCount: jobs.length,
    updatedCount,
    failedCount,
    results,
  };
}

async function getSeriesCoverJobStatus() {
  const supabase = createSupabaseAdminClient();
  const statuses = ["pending", "processing", "completed", "failed"];
  const counts: Record<string, number> = {};

  for (const status of statuses) {
    const { count, error } = await supabase
      .from("series_cover_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

    if (error) {
      throw error;
    }

    counts[status] = count ?? 0;
  }

  return {
    ok: true,
    mode: "status",
    counts,
  };
}

async function fetchTargetSeries({
  supabase,
  limit,
  offset,
  includeImageSet,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  limit: number;
  offset: number;
  includeImageSet: boolean;
}) {
  let query = supabase
    .from("series")
    .select("id, display_title, search_title, representative_image_path")
    .order("display_title", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);

  if (!includeImageSet) {
    query = query.is("representative_image_path", null);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as SeriesRow[];
}

async function claimPendingCoverJobs(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  limit: number,
) {
  const { data, error } = await supabase
    .from("series_cover_jobs")
    .select("id, series_id, status, attempts, max_attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  const jobs = ((data ?? []) as CoverJob[]).filter(
    (job) => job.attempts < job.max_attempts,
  );

  if (jobs.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("series_cover_jobs")
    .upsert(
      jobs.map((job) => ({
        id: job.id,
        series_id: job.series_id,
        status: "processing",
        attempts: job.attempts + 1,
        max_attempts: job.max_attempts,
        locked_at: now,
        started_at: now,
        updated_at: now,
        error_message: null,
      })),
      { onConflict: "id" },
    );

  if (updateError) {
    throw updateError;
  }

  return jobs.map((job) => ({ ...job, attempts: job.attempts + 1 }));
}

async function fetchSeriesRowsByIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  seriesIds: string[],
) {
  if (seriesIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("series")
    .select("id, display_title, search_title, representative_image_path")
    .in("id", seriesIds);

  if (error) {
    throw error;
  }

  return (data ?? []) as SeriesRow[];
}

async function markCoverJobCompleted({
  supabase,
  jobId,
  result,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  jobId: string;
  result: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("series_cover_jobs")
    .update({
      status: "completed",
      locked_at: null,
      completed_at: now,
      updated_at: now,
      error_message: null,
      result,
    })
    .eq("id", jobId);

  if (error) {
    throw error;
  }
}

async function resetCoverJobPending({
  supabase,
  job,
  result,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  job: CoverJob;
  result?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("series_cover_jobs")
    .update({
      status: "pending",
      attempts: Math.max(job.attempts - 1, 0),
      locked_at: null,
      updated_at: now,
      result: result ?? null,
    })
    .eq("id", job.id);

  if (error) {
    throw error;
  }
}

async function markCoverJobFailed({
  supabase,
  job,
  errorMessage,
  result,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  job: CoverJob;
  errorMessage: string;
  result?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("series_cover_jobs")
    .update({
      status: "failed",
      locked_at: null,
      completed_at: now,
      updated_at: now,
      error_message: errorMessage,
      result: result ?? null,
    })
    .eq("id", job.id);

  if (error) {
    throw error;
  }
}

async function fetchSeriesContext(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  seriesIds: string[],
) {
  const context = new Map<string, SeriesContext>(
    seriesIds.map((seriesId) => [
      seriesId,
      { authors: [], publishers: [], imprints: [] },
    ]),
  );

  if (seriesIds.length === 0) {
    return context;
  }

  const [agentResult, publisherResult] = await Promise.all([
    supabase
      .from("series_agents")
      .select("series_id, sort_order, agents(name)")
      .in("series_id", seriesIds)
      .order("sort_order", { ascending: true }),
    supabase
      .from("series_publishers")
      .select("series_id, publishers(imprint_name, publisher_name)")
      .in("series_id", seriesIds),
  ]);

  if (agentResult.error) throw agentResult.error;
  if (publisherResult.error) throw publisherResult.error;

  for (const row of agentResult.data ?? []) {
    const entry = context.get(row.series_id);
    const agent = firstRelation(row.agents) as { name?: string } | null;
    if (entry && agent?.name && !entry.authors.includes(agent.name)) {
      entry.authors.push(agent.name);
    }
  }

  for (const row of publisherResult.data ?? []) {
    const entry = context.get(row.series_id);
    const publisher = firstRelation(row.publishers) as {
      imprint_name?: string;
      publisher_name?: string;
    } | null;

    if (!entry || !publisher) continue;
    if (publisher.publisher_name && !entry.publishers.includes(publisher.publisher_name)) {
      entry.publishers.push(publisher.publisher_name);
    }
    if (publisher.imprint_name && !entry.imprints.includes(publisher.imprint_name)) {
      entry.imprints.push(publisher.imprint_name);
    }
  }

  return context;
}

async function fetchSeriesIsbns(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  seriesIds: string[],
) {
  const result = new Map<string, string[]>(
    seriesIds.map((seriesId) => [seriesId, []]),
  );

  if (seriesIds.length === 0) return result;

  const { data, error } = await supabase
    .from("series_items")
    .select("series_id, isbn, category_number, display_order")
    .in("series_id", seriesIds)
    .order("isbn", { ascending: true });

  if (error) throw error;

  for (const row of data ?? []) {
    const isbns = result.get(row.series_id);
    const normalized = normalizeIsbn(row.isbn);
    if (isbns && normalized && normalized.startsWith("9")) {
      isbns.push(row.isbn);
    }
  }

  return result;
}

async function fetchOfficialSources(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  seriesIds: string[],
) {
  const result = new Map<string, OfficialSource[]>(
    seriesIds.map((seriesId) => [seriesId, []]),
  );

  if (seriesIds.length === 0) return result;

  const { data, error } = await supabase
    .from("series_summary_sources")
    .select("series_id, url, score")
    .in("series_id", seriesIds)
    .eq("status", "fetched")
    .in("source_type", ["publisher_official", "official_site"])
    .order("score", { ascending: false });

  if (error) throw error;

  for (const row of (data ?? []) as OfficialSource[]) {
    result.get(row.series_id)?.push(row);
  }

  return result;
}

async function collectOfficialPageUrls({
  series,
  context,
  isbns,
  existingSources,
}: {
  series: SeriesRow;
  context: SeriesContext | undefined;
  isbns: string[];
  existingSources: OfficialSource[];
}) {
  const searchedUrls = await crawlPublisherSearchUrls(series, context, isbns);
  return uniqueStrings([
    ...directOfficialPageUrls(context, isbns),
    ...existingSources.map((source) => source.url),
    ...searchedUrls,
  ])
    .filter(isLikelyOfficialProductUrl)
    .slice(0, 8);
}

async function crawlPublisherSearchUrls(
  series: SeriesRow,
  context: SeriesContext | undefined,
  isbns: string[],
) {
  const title = series.display_title || series.search_title;
  const author = context?.authors[0];
  const query = uniqueStrings([stripBracketedSubtitle(title), author]).join(" ");
  const candidates = inferPublisherCandidates(context, isbns);
  const urls: string[] = [];

  if (!query) return urls;

  for (const page of publisherSearchPages(query, candidates).slice(0, 8)) {
    try {
      const html = await fetchHtml(page.url);
      const links = extractLinks(html, page.url);
      urls.push(
        ...links.filter(
          (url) =>
            page.allowedDomains.some((domain) =>
              domainFromUrl(url).endsWith(domain),
            ) && isLikelyOfficialProductUrl(url),
        ),
      );
    } catch {
      // Search pages can fail; continue with the next source.
    }
  }

  return uniqueStrings(urls);
}

function publisherSearchPages(query: string, candidates: Set<string>) {
  const encoded = encodeURIComponent(query);
  const doubleEncoded = encodeURIComponent(encoded);
  const pages = [
    { id: "kodansha", url: `https://www.kodansha.co.jp/products/search?keywords=${doubleEncoded}&scope=n&filter%5Bcategory%5D=comic&sort=old&page=1`, allowedDomains: ["kodansha.co.jp"] },
    { id: "kadokawa", url: `https://www.kadokawa.co.jp/search?kw=${encoded}`, allowedDomains: ["kadokawa.co.jp", "store.kadokawa.co.jp"] },
    { id: "kadokawa", url: `https://store.kadokawa.co.jp/shop/goods/search.aspx?keyword=${encoded}`, allowedDomains: ["kadokawa.co.jp", "store.kadokawa.co.jp"] },
    { id: "akita", url: `https://www.akitashoten.co.jp/search?q=${encoded}`, allowedDomains: ["akitashoten.co.jp"] },
    { id: "square_enix", url: `https://magazine.jp.square-enix.com/search/?q=${encoded}`, allowedDomains: ["magazine.jp.square-enix.com"] },
    { id: "shogakukan", url: `https://shogakukan-comic.jp/search?q=${encoded}`, allowedDomains: ["shogakukan-comic.jp"] },
    { id: "shueisha", url: `https://www.shueisha.co.jp/search?keyword=${encoded}`, allowedDomains: ["shueisha.co.jp", "s-manga.net"] },
    { id: "ichijinsha", url: `https://www.ichijinsha.co.jp/?s=${encoded}`, allowedDomains: ["ichijinsha.co.jp"] },
  ];

  return pages.filter((page) => candidates.size === 0 || candidates.has(page.id));
}

function directOfficialPageUrls(
  context: SeriesContext | undefined,
  isbns: string[],
) {
  const candidates = inferPublisherCandidates(context, isbns);
  const urls: string[] = [];

  if (candidates.has("shueisha")) {
    const shueishaIsbn = lowestNormalizedIsbnWithPrefix(isbns, "978408");

    if (shueishaIsbn) {
      urls.push(
        `https://www.shueisha.co.jp/books/items/contents.html?isbn=${formatShueishaIsbnQuery(shueishaIsbn)}`,
      );
    }
  }

  return urls;
}

async function findCoverImageFromOfficialPages({
  series,
  sourceUrls,
  isbns,
}: {
  series: SeriesRow;
  sourceUrls: string[];
  isbns: string[];
}) {
  let best: { sourceUrl: string; imageUrl: string; score: number } | null = null;

  for (const sourceUrl of sourceUrls) {
    try {
      const html = await fetchHtml(sourceUrl);
      if (!sourcePageMatchesSeries(html, series, isbns)) {
        continue;
      }

      const candidate = extractImageCandidates(html, sourceUrl, series, isbns)[0];
      if (candidate && (!best || candidate.score > best.score)) {
        best = { sourceUrl, imageUrl: candidate.url, score: candidate.score };
      }
    } catch {
      // Try the next official page.
    }
  }

  return best;
}

function extractImageCandidates(
  html: string,
  baseUrl: string,
  series: SeriesRow,
  isbns: string[],
) {
  const candidates: ImageCandidate[] = [];
  const addCandidate = (url: string | null, score: number, reason: string) => {
    const normalized = normalizeImageUrl(url, baseUrl);
    if (!normalized) return;
    candidates.push({
      url: normalized,
      score: score + scoreImageUrl(normalized, series, isbns),
      reason,
    });
  };

  addCandidate(extractMetaContent(html, "og:image"), 100, "og:image");
  addCandidate(extractMetaContent(html, "twitter:image"), 90, "twitter:image");
  addCandidate(extractLinkRelImage(html), 80, "image_src");

  for (const image of extractStructuredDataImages(html)) {
    addCandidate(image, 85, "structured_data");
  }

  const imagePattern = /<img\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(html))) {
    const attributes = match[1] ?? "";
    const src =
      extractAttribute(attributes, "src") ??
      extractAttribute(attributes, "data-src") ??
      extractAttribute(attributes, "data-original");
    if (!src) continue;
    const label = [
      extractAttribute(attributes, "alt"),
      extractAttribute(attributes, "title"),
      extractAttribute(attributes, "class"),
    ].join(" ");
    const labelScore = /cover|book|product|商品|書影|表紙|main|jacket/i.test(label)
      ? 35
      : 0;
    addCandidate(src, 45 + labelScore, "img");
  }

  return mergeImageCandidates(candidates)
    .filter((candidate) => candidate.score >= 80)
    .sort((a, b) => b.score - a.score);
}

async function uploadSeriesCoverFromUrl({
  supabase,
  series,
  imageUrl,
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  series: SeriesRow;
  imageUrl: string;
}) {
  const response = await fetch(imageUrl, {
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (compatible; MangaReleaseCoverBot/1.0; +https://manga-release-pwa.vercel.app)",
    },
  });

  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);

  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  const extension = ALLOWED_IMAGE_TYPES.get(contentType);
  if (!extension) throw new Error(`Unsupported image type: ${contentType || "unknown"}`);

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_SIZE) throw new Error("Image file is too large.");

  const uploadedAt = new Date();
  const path = `series/${series.id}/${formatStorageTimestamp(uploadedAt)}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(SERIES_COVERS_BUCKET)
    .upload(path, new Blob([bytes], { type: contentType }), {
      upsert: false,
      contentType,
      cacheControl: "31536000",
    });

  if (uploadError) throw uploadError;

  const { data, error: updateError } = await supabase
    .from("series")
    .update({
      representative_image_path: path,
      updated_at: uploadedAt.toISOString(),
    })
    .eq("id", series.id)
    .select("representative_image_path")
    .single();

  if (updateError) throw updateError;

  if (series.representative_image_path && series.representative_image_path !== path) {
    const { error: removeError } = await supabase.storage
      .from(SERIES_COVERS_BUCKET)
      .remove([series.representative_image_path]);

    if (removeError) {
      console.warn(
        "[Series cover jobs] Failed to remove old cover.",
        removeError,
      );
    }
  }

  return {
    path: data.representative_image_path as string,
    url: await createSeriesCoverUrl(
      supabase,
      data.representative_image_path as string,
    ),
  };
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (compatible; MangaReleaseCoverBot/1.0; +https://manga-release-pwa.vercel.app)",
    },
  });

  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }
  return response.text();
}

function inferPublisherCandidates(
  context: SeriesContext | undefined,
  isbns: string[],
) {
  const candidates = new Set<string>();
  const joined = normalizeComparableText(
    [...(context?.publishers ?? []), ...(context?.imprints ?? [])].join(" "),
  );

  if (/kodansha|講談社|モーニング|ヤンマガ|マガジン/.test(joined)) candidates.add("kodansha");
  if (/kadokawa|角川|電撃|ドラゴン|アライブ|フラッパー/.test(joined)) candidates.add("kadokawa");
  if (/akitashoten|秋田書店|チャンピオン/.test(joined)) candidates.add("akita");
  if (/squareenix|スクウェアエニックス|スクエニ|ガンガン|joker/.test(joined)) candidates.add("square_enix");
  if (/shogakukan|小学館|サンデー|ビッグコミック|スピリッツ|ちゃお/.test(joined)) candidates.add("shogakukan");
  if (/shueisha|集英社|ジャンプ|マーガレット|りぼん|ヤングジャンプ/.test(joined)) candidates.add("shueisha");
  if (/ichijinsha|一迅社|百合姫|comicrex/.test(joined)) candidates.add("ichijinsha");

  for (const isbn of isbns) {
    const normalized = normalizeIsbn(isbn);
    if (!normalized) continue;
    if (normalized.startsWith("978406")) candidates.add("kodansha");
    if (normalized.startsWith("978404")) candidates.add("kadokawa");
    if (normalized.startsWith("978425")) candidates.add("akita");
    if (normalized.startsWith("978409")) candidates.add("shogakukan");
    if (normalized.startsWith("978408")) candidates.add("shueisha");
    if (normalized.startsWith("978475") && candidates.size === 0) {
      candidates.add("square_enix");
      candidates.add("ichijinsha");
    }
  }

  return candidates;
}

function isLikelyOfficialProductUrl(url: string) {
  const domain = domainFromUrl(url);
  if (!domain) return false;

  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    return (
      (domain === "shogakukan-comic.jp" &&
        path === "/book" &&
        (parsed.searchParams.has("isbn") || parsed.searchParams.has("jdcn"))) ||
      (domain === "www.kodansha.co.jp" &&
        /^\/comic\/products\/[^/]+\/?$/.test(path)) ||
      (domain === "www.kadokawa.co.jp" && /^\/product\/[^/]+\/?$/.test(path)) ||
      (domain === "store.kadokawa.co.jp" && /^\/shop\/g\/g[^/]+\/?$/.test(path)) ||
      (domain === "www.akitashoten.co.jp" && /^\/(series|comics)\/[^/]+\/?$/.test(path)) ||
      (domain === "magazine.jp.square-enix.com" &&
        /^\/top\/comics\/detail\/[^/]+\/?$/.test(path)) ||
      (/^(www\.)?shueisha\.co\.jp$/.test(domain) &&
        path === "/books/items/contents.html") ||
      ((domain === "books.shueisha.co.jp" || domain === "www.s-manga.net") &&
        /^\/items\/contents(_amp)?\.html$/.test(path)) ||
      (domain === "www.ichijinsha.co.jp" &&
        /^\/(yurihime\/title|stories\/comic-rex)\/.+/.test(path))
    );
  } catch {
    return false;
  }
}

function sourcePageMatchesSeries(
  html: string,
  series: SeriesRow,
  isbns: string[],
) {
  const comparableHtml = normalizeComparableText(html);
  const titleTokens = uniqueStrings([
    series.display_title,
    series.search_title,
    stripBracketedSubtitle(series.display_title),
    stripBracketedSubtitle(series.search_title),
    stripParentheticalSuffix(series.display_title),
    stripParentheticalSuffix(series.search_title),
  ])
    .map(normalizeComparableText)
    .filter((token) => token.length >= 2);

  if (titleTokens.some((token) => comparableHtml.includes(token))) {
    return true;
  }

  return isbns.some((isbn) => {
    const normalized = normalizeIsbn(isbn);
    return normalized ? comparableHtml.includes(normalized) : false;
  });
}

function extractLinks(html: string, baseUrl: string) {
  const links: string[] = [];
  const pattern = /<a\b[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const href = decodeHtmlEntities(match[1] ?? "");
    if (!href || href.startsWith("#") || href.startsWith("mailto:")) continue;
    try {
      links.push(new URL(href, baseUrl).toString());
    } catch {
      // Ignore malformed links.
    }
  }

  return uniqueStrings(links);
}

function extractMetaContent(html: string, name: string) {
  const pattern = /<meta\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const attributes = match[1] ?? "";
    const metaName =
      extractAttribute(attributes, "name") ??
      extractAttribute(attributes, "property");

    if (metaName?.toLowerCase() === name.toLowerCase()) {
      return extractAttribute(attributes, "content");
    }
  }

  return null;
}

function extractLinkRelImage(html: string) {
  const pattern = /<link\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const attributes = match[1] ?? "";
    const rel = extractAttribute(attributes, "rel") ?? "";

    if (/(^|\s)(image_src|preload)(\s|$)/i.test(rel)) {
      return extractAttribute(attributes, "href");
    }
  }

  return null;
}

function extractStructuredDataImages(html: string) {
  const images: string[] = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(html))) {
    const attributes = match[1] ?? "";
    const rawScript = match[2] ?? "";
    if (!/application\/(ld\+json|json)/i.test(attributes)) continue;
    try {
      collectImageValues(JSON.parse(decodeHtmlEntities(rawScript)), images);
    } catch {
      for (const imageMatch of rawScript.matchAll(/"image"\s*:\s*"([^"]+)"/gi)) {
        images.push(imageMatch[1] ?? "");
      }
    }
  }
  return uniqueStrings(images);
}

function collectImageValues(value: unknown, images: string[]) {
  if (typeof value === "string") {
    if (/^https?:\/\//.test(value) && /\.(jpe?g|png|webp)(\?|$)/i.test(value)) {
      images.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectImageValues(item, images);
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    collectImageValues(record.image, images);
    collectImageValues(record.thumbnailUrl, images);
    collectImageValues(record.primaryImageOfPage, images);
  }
}

function normalizeImageUrl(url: string | null, baseUrl: string) {
  if (!url || /^data:/i.test(url)) return null;
  try {
    return new URL(decodeHtmlEntities(url), baseUrl).toString();
  } catch {
    return null;
  }
}

function scoreImageUrl(url: string, series: SeriesRow, isbns: string[]) {
  const comparableUrl = normalizeComparableText(url);
  let score = 0;
  if (/cover|jacket|book|product|comic|contents|978|isbn/.test(comparableUrl)) score += 25;
  if (/\.(jpe?g|png|webp)(\?|$)/i.test(url)) score += 15;
  for (const isbn of isbns) {
    const normalized = normalizeIsbn(isbn);
    if (normalized && comparableUrl.includes(normalized)) score += 35;
  }
  const title = normalizeComparableText(stripBracketedSubtitle(series.display_title));
  if (title.length >= 2 && comparableUrl.includes(title)) score += 15;
  if (/logo|banner|bnr|sns|icon|noimage|avatar|author|ogp_common/.test(comparableUrl)) {
    score -= 80;
  }
  return score;
}

function mergeImageCandidates(candidates: ImageCandidate[]) {
  const byUrl = new Map<string, ImageCandidate>();
  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.url);
    if (!existing || candidate.score > existing.score) byUrl.set(candidate.url, candidate);
  }
  return [...byUrl.values()];
}

function extractAttribute(attributes: string, name: string) {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)["']`, "i");
  return attributes.match(pattern)?.[1]?.trim() ?? null;
}

function stripBracketedSubtitle(title: string) {
  return title.replace(/[（(][^）)]*[）)]/g, "").replace(/[「」『』]/g, "").trim();
}

function stripParentheticalSuffix(title: string) {
  return title.replace(/\s*[\(（][^\)）]*[\)）]\s*$/u, "").trim();
}

function normalizeComparableText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function normalizeIsbn(value: string) {
  const normalized = value.replace(/[^0-9Xx]/g, "").toUpperCase();
  return normalized.length >= 10 ? normalized : null;
}

function lowestNormalizedIsbnWithPrefix(isbns: string[], prefix: string) {
  return uniqueStrings(isbns.map(normalizeIsbn))
    .filter((isbn) => isbn.startsWith(prefix))
    .sort()[0] ?? null;
}

function formatShueishaIsbnQuery(isbn: string) {
  if (/^978408\d{7}$/.test(isbn)) {
    return `978-4-08-${isbn.slice(6, 12)}-${isbn.slice(12)}`;
  }

  return isbn;
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatStorageTimestamp(date: Date) {
  const pad = (value: number, length = 2) => value.toString().padStart(length, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    pad(date.getUTCMilliseconds(), 3),
  ].join("");
}

function clampPositiveInteger(value: number, max: number) {
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return 1;
  return Math.min(normalized, max);
}

function clampNonNegativeInteger(value: number) {
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized < 0) return 0;
  return normalized;
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
