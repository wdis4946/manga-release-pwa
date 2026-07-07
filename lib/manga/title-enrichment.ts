import {
  type OpenBdBook,
  fetchOpenBdBooksByIsbns,
} from "@/lib/openbd";
import { fetchRakutenBookByIsbn } from "@/lib/rakuten/client";
import { toRakutenMangaItemRow } from "@/lib/rakuten/import";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 50;
const REQUEST_INTERVAL_MS = 1100;

type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;

type SourceBook = {
  source: "rakuten" | "openbd";
  title: string;
  normalizedTitle: string;
};

type EnrichmentDetail = {
  isbn: string;
  status: "linked" | "found_unmatched" | "not_found" | "error";
  source?: SourceBook["source"];
  title?: string;
  normalizedTitle?: string;
  candidateCount?: number;
  linkedSeriesId?: string;
  error?: string;
};

type LinkResult = {
  linked: boolean;
  candidateCount: number;
  seriesId?: string;
};

type RakutenLookupState = {
  lastLookupAt?: number;
};

export async function enrichUnmatchedTitles(request: Request) {
  const limitParameter = new URL(request.url).searchParams.get("limit");
  const requestedSize = limitParameter === null ? NaN : Number(limitParameter);
  const batchSize = Number.isInteger(requestedSize)
    ? Math.max(1, Math.min(requestedSize, MAX_BATCH_SIZE))
    : DEFAULT_BATCH_SIZE;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("series_item_match_issues")
    .select("isbn")
    .eq("issue_type", "unmatched")
    .eq("is_resolved", false)
    .or("title_lookup_status.is.null,title_lookup_status.eq.error")
    .order("isbn")
    .limit(batchSize);

  if (error) {
    throw error;
  }

  const totals = {
    processedCount: 0,
    foundCount: 0,
    linkedCount: 0,
    notFoundCount: 0,
    errorCount: 0,
  };
  const details: EnrichmentDetail[] = [];

  console.info("[Title enrichment] Batch started.", {
    batchSize,
    targetCount: data?.length ?? 0,
    isbns: (data ?? []).map((issue) => issue.isbn),
  });

  const targetIsbns = (data ?? []).map((issue) => issue.isbn);
  const openBdBooks = await fetchOpenBdBookMap(targetIsbns);
  const rakutenLookupState: RakutenLookupState = {};

  for (const issue of data ?? []) {
    let detail: EnrichmentDetail;

    try {
      const sourceBook = await fetchAndSaveBook(
        supabase,
        issue.isbn,
        openBdBooks.get(issue.isbn),
        rakutenLookupState,
      );

      if (!sourceBook) {
        await updateIssue(supabase, issue.isbn, {
          title_lookup_status: "not_found",
          title_lookup_at: new Date().toISOString(),
          resolution_note:
            "ISBN was not found in Rakuten Books or openBD.",
        });
        totals.notFoundCount += 1;
        detail = {
          isbn: issue.isbn,
          status: "not_found",
        };
      } else {
        const linkResult = await linkExactSeries(
          supabase,
          issue.isbn,
          sourceBook,
        );
        totals.foundCount += 1;
        totals.linkedCount += linkResult.linked ? 1 : 0;
        detail = {
          isbn: issue.isbn,
          status: linkResult.linked ? "linked" : "found_unmatched",
          source: sourceBook.source,
          title: sourceBook.title,
          normalizedTitle: sourceBook.normalizedTitle,
          candidateCount: linkResult.candidateCount,
          linkedSeriesId: linkResult.seriesId,
        };
      }
    } catch (lookupError) {
      const errorMessage = getErrorMessage(lookupError);
      console.error("[Title enrichment] ISBN lookup failed.", {
        isbn: issue.isbn,
        error: errorMessage,
      });
      await updateIssue(supabase, issue.isbn, {
        title_lookup_status: "error",
        title_lookup_at: new Date().toISOString(),
        resolution_note: `External title lookup failed; retry is allowed. ${errorMessage}`,
      });
      totals.errorCount += 1;
      detail = {
        isbn: issue.isbn,
        status: "error",
        error: errorMessage,
      };
    }

    details.push(detail);
    totals.processedCount += 1;
    console.info("[Title enrichment] ISBN processed.", detail);
  }

  console.info("[Title enrichment] Batch completed.", {
    ...totals,
    details,
  });
  return {
    ...totals,
    completed: data.length < batchSize,
    details,
  };
}

async function fetchAndSaveBook(
  supabase: SupabaseAdminClient,
  isbn: string,
  openBdBook: OpenBdBook | undefined,
  rakutenLookupState: RakutenLookupState,
): Promise<SourceBook | undefined> {
  const fetchedAt = new Date().toISOString();
  const openBdSource = await saveOpenBdBook(supabase, isbn, openBdBook, fetchedAt);

  // openBD supports bulk ISBN lookup, so it is the primary source here.
  // Rakuten is only used for ISBNs that openBD cannot resolve.
  if (openBdSource) {
    return openBdSource;
  }

  await waitForRakutenRateLimit(rakutenLookupState);
  const rakutenBook = await fetchRakutenBookByIsbn(isbn);

  if (!rakutenBook) {
    return undefined;
  }

  const row = toRakutenMangaItemRow(rakutenBook, fetchedAt);

  if (!row) {
    return undefined;
  }

  const { data, error } = await supabase
    .from("rakuten_manga_items")
    .upsert(row, { onConflict: "isbn" })
    .select("title, normalized_title")
    .single();

  if (error) {
    throw error;
  }

  return {
    source: "rakuten",
    title: data.title,
    normalizedTitle: data.normalized_title,
  };
}

async function fetchOpenBdBookMap(
  isbns: string[],
): Promise<Map<string, OpenBdBook>> {
  try {
    const books = await fetchOpenBdBooksByIsbns(isbns);
    console.info("[Title enrichment] openBD batch completed.", {
      requestedCount: isbns.length,
      foundCount: books.size,
    });
    return books;
  } catch (error) {
    console.error("[Title enrichment] openBD batch failed.", {
      error: getErrorMessage(error),
    });
    return new Map();
  }
}

async function saveOpenBdBook(
  supabase: SupabaseAdminClient,
  isbn: string,
  openBdBook: OpenBdBook | undefined,
  fetchedAt: string,
): Promise<SourceBook | undefined> {
  const summary = openBdBook?.summary;

  if (!openBdBook || !summary?.title) {
    return undefined;
  }

  const { data, error } = await supabase
    .from("openbd_manga_items")
    .upsert(
      {
        isbn,
        title: summary.title,
        author: summary.author ?? null,
        publisher: summary.publisher ?? null,
        series: summary.series ?? null,
        publication_date: summary.pubdate ?? null,
        cover_url: summary.cover ?? null,
        raw_response: openBdBook,
        last_fetched_at: fetchedAt,
        updated_at: fetchedAt,
      },
      { onConflict: "isbn" },
    )
    .select("title, normalized_title")
    .single();

  if (error) {
    throw error;
  }

  return {
    source: "openbd",
    title: data.title,
    normalizedTitle: data.normalized_title,
  };
}

async function waitForRakutenRateLimit(
  state: RakutenLookupState,
): Promise<void> {
  if (state.lastLookupAt) {
    const elapsed = Date.now() - state.lastLookupAt;
    const waitTime = REQUEST_INTERVAL_MS - elapsed;

    if (waitTime > 0) {
      await delay(waitTime);
    }
  }

  state.lastLookupAt = Date.now();
}

async function linkExactSeries(
  supabase: SupabaseAdminClient,
  isbn: string,
  book: SourceBook,
): Promise<LinkResult> {
  const { data: candidates, error } = await supabase
    .from("series")
    .select("id")
    .eq("search_title", book.normalizedTitle)
    .limit(2);

  if (error) {
    throw error;
  }

  const lookupAt = new Date().toISOString();

  if (candidates?.length === 1) {
    const { error: linkError } = await supabase
      .from("series_items")
      .upsert(
        {
          isbn,
          series_id: candidates[0].id,
          match_method: `${book.source}_title_exact`,
          matched_by: null,
          matched_at: lookupAt,
          updated_at: lookupAt,
        },
        { onConflict: "isbn" },
      );

    if (linkError) {
      throw linkError;
    }

    const { error: deleteError } = await supabase
      .from("series_item_match_issues")
      .delete()
      .eq("isbn", isbn);

    if (deleteError) {
      throw deleteError;
    }

    return {
      linked: true,
      candidateCount: 1,
      seriesId: candidates[0].id,
    };
  }

  await updateIssue(supabase, isbn, {
    normalized_title: book.normalizedTitle,
    source_title: book.title,
    title_source: book.source,
    title_lookup_status: "found",
    title_lookup_at: lookupAt,
    candidate_count: candidates?.length ?? 0,
    candidate_series_ids: (candidates ?? []).map((candidate) => candidate.id),
    resolution_note:
      candidates?.length === 0
        ? "A title was found, but no series matched it exactly."
        : "A title was found, but multiple series matched it exactly.",
  });
  return {
    linked: false,
    candidateCount: candidates?.length ?? 0,
  };
}

async function updateIssue(
  supabase: SupabaseAdminClient,
  isbn: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("series_item_match_issues")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("isbn", isbn);

  if (error) {
    throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
