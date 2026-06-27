import { NextResponse } from "next/server";
import { fetchRakutenBookPage } from "@/lib/rakuten/client";
import { toRakutenMangaItemRow } from "@/lib/rakuten/import";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  try {
    const result = await fetchRakutenBookPage({
      sort: "latest",
      page: 1,
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

    if (rows.length === 0) {
      console.warn("[Rakuten import] No valid ISBN items were returned.", {
        fetchedCount: result.items.length,
      });
      return NextResponse.json({ ok: true });
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("rakuten_manga_items")
      .upsert(rows, { onConflict: "isbn" });

    if (error) {
      throw error;
    }

    console.info("[Rakuten import] Page imported.", {
      sourcePage: result.page,
      sourcePageCount: result.pageCount,
      sourceCount: result.count,
      fetchedCount: result.items.length,
      savedCount: rows.length,
      skippedCount: result.items.length - rows.length,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Rakuten import] Import failed.", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// Vercel Cron invokes GET; POST is convenient for an authenticated manual run.
export const GET = importRakutenManga;
export const POST = importRakutenManga;
