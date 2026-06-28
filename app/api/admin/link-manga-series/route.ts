import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
    const { data, error } = await supabase.rpc("link_rakuten_manga_items");

    if (error) {
      throw error;
    }

    const result = data?.[0] ?? {
      matched_count: 0,
      unmatched_count: 0,
      ambiguous_count: 0,
    };

    console.info("[Manga linking] Linking completed.", result);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[Manga linking] Linking failed.", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
