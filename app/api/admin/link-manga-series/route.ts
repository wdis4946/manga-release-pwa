import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

type LinkBatchResult = {
  next_isbn: string | null;
  processed_count: number;
  matched_count: number;
  unmatched_count: number;
  ambiguous_count: number;
};

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[Manga linking] CRON_SECRET is not configured.");
    return Response.json({ ok: false }, { status: 500 });
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    let cursor: string | null = null;
    let processedCount = 0;
    let matchedCount = 0;
    let unmatchedCount = 0;
    let ambiguousCount = 0;

    while (true) {
      const rpcResult = await supabase.rpc(
        "link_rakuten_manga_items_batch",
        {
          p_after_isbn: cursor,
          p_batch_size: 500,
        },
      );
      const data = rpcResult.data as LinkBatchResult[] | null;
      const { error } = rpcResult;

      if (error) {
        throw error;
      }

      const batch = data?.[0];

      if (!batch || batch.processed_count === 0) {
        break;
      }

      processedCount += batch.processed_count;
      matchedCount += batch.matched_count;
      unmatchedCount += batch.unmatched_count;
      ambiguousCount += batch.ambiguous_count;
      cursor = batch.next_isbn;

      console.info("[Manga linking] Batch completed.", {
        cursor,
        processedCount,
      });

      if (!cursor || batch.processed_count < 500) {
        break;
      }
    }

    const result = {
      processed_count: processedCount,
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
      ambiguous_count: ambiguousCount,
    };

    console.info("[Manga linking] Linking completed.", result);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[Manga linking] Linking failed.", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
