import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type LinkSeriesRequest = {
  seriesId?: string;
  sortOrder?: number | null;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as LinkSeriesRequest;
  const seriesId = body.seriesId?.trim();

  if (!seriesId) {
    return Response.json({ error: "Series id is required." }, { status: 400 });
  }

  if (
    body.sortOrder !== undefined &&
    body.sortOrder !== null &&
    !Number.isInteger(body.sortOrder)
  ) {
    return Response.json(
      { error: "Sort order must be an integer." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  let sortOrder = body.sortOrder ?? null;

  if (sortOrder === null) {
    const { data, error } = await supabase
      .from("display_group_series")
      .select("sort_order")
      .eq("display_group_id", id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    sortOrder = (data?.sort_order ?? -1) + 1;
  }

  const { error } = await supabase.from("display_group_series").upsert(
    {
      display_group_id: id,
      series_id: seriesId,
      sort_order: sortOrder,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "display_group_id,series_id" },
  );

  if (error) {
    const status = error.code === "23503" ? 404 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({ ok: true });
}
