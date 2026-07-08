import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

type AdminSeriesListRow = {
  id: string;
  search_title: string;
  display_title: string;
  description: string | null;
  representative_image_path: string | null;
  series_items?: { isbn: string }[];
};

type AdminSeriesBaseRow = Omit<AdminSeriesListRow, "series_items">;

function toSeriesResponse(
  row: AdminSeriesBaseRow,
  itemCount: number,
  supabase: ReturnType<typeof createSupabaseAdminClient>,
) {
  const representativeImageUrl = row.representative_image_path
    ? supabase.storage
        .from("series-covers")
        .getPublicUrl(row.representative_image_path).data.publicUrl
    : null;

  return {
    id: row.id,
    searchTitle: row.search_title,
    displayTitle: row.display_title,
    description: row.description,
    representativeImagePath: row.representative_image_path,
    representativeImageUrl,
    itemCount,
  };
}

export async function GET(request: Request) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const queryText = searchParams.get("q")?.trim();
  const excludeEmpty = searchParams.get("excludeEmpty") === "true";
  const from = (page - 1) * PAGE_SIZE;
  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from("series")
    .select(
      excludeEmpty
        ? "id, search_title, display_title, description, representative_image_path, series_items!inner(isbn)"
        : "id, search_title, display_title, description, representative_image_path",
      { count: "exact" },
    )
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

  if (excludeEmpty) {
    const rows = (seriesRows ?? []) as unknown as AdminSeriesListRow[];

    return Response.json({
      series: rows.map((row) =>
        toSeriesResponse(row, row.series_items?.length ?? 0, supabase),
      ),
      page,
      pageSize: PAGE_SIZE,
      total: count ?? 0,
    });
  }

  const baseRows = (seriesRows ?? []) as unknown as AdminSeriesBaseRow[];
  const seriesIds = baseRows.map((series) => series.id);
  const { data: linkRows, error: linkError } =
    seriesIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("series_items")
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
    series: baseRows.map((row) =>
      toSeriesResponse(row, itemCounts.get(row.id) ?? 0, supabase),
    ),
    page,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
  });
}
