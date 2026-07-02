import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const queryText = searchParams.get("q")?.trim();
  const from = (page - 1) * PAGE_SIZE;
  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from("manga_series")
    .select("id, search_title, display_title", { count: "exact" })
    .order("display_title", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);

  if (queryText) {
    query = query.ilike("display_title", `%${queryText}%`);
  }

  const { data: seriesRows, count, error } = await query;

  if (error) {
    console.error("[Admin series] Failed to load series.", error);
    return Response.json({ error: "Failed to load series." }, { status: 500 });
  }

  const seriesIds = (seriesRows ?? []).map((series) => series.id);
  const { data: linkRows, error: linkError } =
    seriesIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("manga_series_items")
          .select("series_id")
          .in("series_id", seriesIds);

  if (linkError) {
    console.error("[Admin series] Failed to count linked items.", linkError);
    return Response.json(
      { error: "Failed to count linked items." },
      { status: 500 },
    );
  }

  const itemCounts = new Map<string, number>();
  for (const link of linkRows ?? []) {
    itemCounts.set(link.series_id, (itemCounts.get(link.series_id) ?? 0) + 1);
  }

  return Response.json({
    series: (seriesRows ?? []).map((row) => ({
      id: row.id,
      searchTitle: row.search_title,
      displayTitle: row.display_title,
      itemCount: itemCounts.get(row.id) ?? 0,
    })),
    page,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
  });
}
