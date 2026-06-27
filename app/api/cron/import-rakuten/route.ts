import { NextResponse } from "next/server";
import { fetchRakutenBookPage } from "@/lib/rakuten/client";
import { toRakutenMangaItemRow } from "@/lib/rakuten/import";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOB_NAME = "all-comics-latest";
const PAGES_PER_RUN = 5;
const REQUEST_INTERVAL_MS = 400;

async function importRakutenManga(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[Rakuten import] CRON_SECRET is not configured.");
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const startedAt = performance.now();
  const supabase = createSupabaseAdminClient();

  try {
    const { data: state, error: stateError } = await supabase
      .from("rakuten_import_state")
      .select("next_page, cycle_number")
      .eq("job_name", JOB_NAME)
      .maybeSingle();

    if (stateError) {
      throw stateError;
    }

    let nextPage = state?.next_page ?? 1;
    let cycleNumber = state?.cycle_number ?? 1;
    let fetchedCount = 0;
    let savedCount = 0;

    for (let index = 0; index < PAGES_PER_RUN; index += 1) {
      const result = await fetchRakutenBookPage({
        sort: "latest",
        page: nextPage,
        hits: 30,
      });
      const fetchedAt = new Date().toISOString();
      const rowsByIsbn = new Map(
        result.items
          .map((item) => toRakutenMangaItemRow(item, fetchedAt))
          .filter((row) => row !== null)
          .map((row) => [row.isbn, row]),
      );
      const rows = Array.from(rowsByIsbn.values());

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from("rakuten_manga_items")
          .upsert(rows, { onConflict: "isbn" });

        if (upsertError) {
          throw upsertError;
        }
      }

      fetchedCount += result.items.length;
      savedCount += rows.length;

      const reachedLastPage =
        result.pageCount === 0 || nextPage >= result.pageCount;
      nextPage = reachedLastPage ? 1 : nextPage + 1;
      cycleNumber = reachedLastPage ? cycleNumber + 1 : cycleNumber;

      // Persist after every page so a later failure resumes from this point.
      const { error: cursorError } = await supabase
        .from("rakuten_import_state")
        .upsert(
          {
            job_name: JOB_NAME,
            next_page: nextPage,
            cycle_number: cycleNumber,
            last_run_at: fetchedAt,
            updated_at: fetchedAt,
          },
          { onConflict: "job_name" },
        );

      if (cursorError) {
        throw cursorError;
      }

      console.info("[Rakuten import] Page imported.", {
        sourcePage: result.page,
        sourcePageCount: result.pageCount,
        fetchedCount: result.items.length,
        savedCount: rows.length,
      });

      if (index < PAGES_PER_RUN - 1) {
        await delay(REQUEST_INTERVAL_MS);
      }
    }

    console.info("[Rakuten import] Batch completed.", {
      fetchedCount,
      savedCount,
      nextPage,
      cycleNumber,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Rakuten import] Import failed.", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Vercel Cron invokes GET; POST remains available for authenticated manual runs.
export const GET = importRakutenManga;
export const POST = importRakutenManga;
