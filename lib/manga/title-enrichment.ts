import { fetchOpenBdBookByIsbn } from "@/lib/openbd";
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

export async function enrichUnmatchedTitles(request: Request) {
  const limitParameter = new URL(request.url).searchParams.get("limit");
  const requestedSize = limitParameter === null ? NaN : Number(limitParameter);
  const batchSize = Number.isInteger(requestedSize)
    ? Math.max(1, Math.min(requestedSize, MAX_BATCH_SIZE))
    : DEFAULT_BATCH_SIZE;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("manga_series_item_match_issues")
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

  for (const issue of data ?? []) {
    try {
      const sourceBook = await fetchAndSaveBook(supabase, issue.isbn);

      if (!sourceBook) {
        await updateIssue(supabase, issue.isbn, {
          title_lookup_status: "not_found",
          title_lookup_at: new Date().toISOString(),
          resolution_note:
            "ISBN was not found in Rakuten Books or openBD.",
        });
        totals.notFoundCount += 1;
      } else {
        const linked = await linkExactSeries(
          supabase,
          issue.isbn,
          sourceBook,
        );
        totals.foundCount += 1;
        totals.linkedCount += linked ? 1 : 0;
      }
    } catch (lookupError) {
      console.error("[Title enrichment] ISBN lookup failed.", {
        isbn: issue.isbn,
        error: lookupError,
      });
      await updateIssue(supabase, issue.isbn, {
        title_lookup_status: "error",
        title_lookup_at: new Date().toISOString(),
        resolution_note: "External title lookup failed; retry is allowed.",
      });
      totals.errorCount += 1;
    }

    totals.processedCount += 1;
    if (totals.processedCount < data.length) {
      await delay(REQUEST_INTERVAL_MS);
    }
  }

  console.info("[Title enrichment] Batch completed.", totals);
  return {
    ...totals,
    completed: data.length < batchSize,
  };
}

async function fetchAndSaveBook(
  supabase: SupabaseAdminClient,
  isbn: string,
): Promise<SourceBook | undefined> {
  const fetchedAt = new Date().toISOString();
  const rakutenBook = await fetchRakutenBookByIsbn(isbn);

  // Prefer Rakuten because its complete item shape already has a local table.
  // openBD fills ISBNs that are no longer represented in Rakuten Books.
  if (rakutenBook) {
    const row = toRakutenMangaItemRow(rakutenBook, fetchedAt);
    if (row) {
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
  }

  const openBdBook = await fetchOpenBdBookByIsbn(isbn);
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

async function linkExactSeries(
  supabase: SupabaseAdminClient,
  isbn: string,
  book: SourceBook,
): Promise<boolean> {
  const { data: candidates, error } = await supabase
    .from("manga_series")
    .select("id")
    .eq("search_title", book.normalizedTitle)
    .limit(2);

  if (error) {
    throw error;
  }

  const lookupAt = new Date().toISOString();

  if (candidates?.length === 1) {
    const { error: linkError } = await supabase
      .from("manga_series_items")
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
      .from("manga_series_item_match_issues")
      .delete()
      .eq("isbn", isbn);

    if (deleteError) {
      throw deleteError;
    }

    return true;
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
  return false;
}

async function updateIssue(
  supabase: SupabaseAdminClient,
  isbn: string,
  values: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("manga_series_item_match_issues")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("isbn", isbn);

  if (error) {
    throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
