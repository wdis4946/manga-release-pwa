import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type LinkSeriesRequest = {
  seriesId?: string;
  seriesIds?: string[];
  sortOrder?: number | null;
};

type UpdateSeriesOrdersRequest = {
  seriesOrders?: Array<{
    seriesId?: string;
    sortOrder?: number;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as LinkSeriesRequest;
  const seriesIds = [
    ...new Set(
      [body.seriesId, ...(body.seriesIds ?? [])]
        .map((seriesId) => seriesId?.trim() ?? "")
        .filter(Boolean),
    ),
  ];

  if (seriesIds.length === 0) {
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

  const { data: existingLinks, error: existingLinksError } = await supabase
    .from("display_group_series")
    .select("series_id, sort_order")
    .eq("display_group_id", id);

  if (existingLinksError) {
    return Response.json({ error: existingLinksError.message }, { status: 500 });
  }

  const existingSeriesIds = new Set(
    (existingLinks ?? []).map((link) => link.series_id as string),
  );
  const newSeriesIds = seriesIds.filter(
    (seriesId) => !existingSeriesIds.has(seriesId),
  );

  if (newSeriesIds.length === 0) {
    return Response.json({ ok: true, linkedCount: 0 });
  }

  if (sortOrder === null) {
    sortOrder =
      Math.max(
        -1,
        ...(existingLinks ?? []).map((link) => link.sort_order as number),
      ) + 1;
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("display_group_series").insert(
    newSeriesIds.map((seriesId, index) => ({
      display_group_id: id,
      series_id: seriesId,
      sort_order: sortOrder + index,
      updated_at: now,
    })),
  );

  if (error) {
    const status = error.code === "23503" ? 404 : 500;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({ ok: true, linkedCount: newSeriesIds.length });
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as UpdateSeriesOrdersRequest;
  const seriesOrders = (body.seriesOrders ?? [])
    .map((seriesOrder) => ({
      seriesId: seriesOrder.seriesId?.trim() ?? "",
      sortOrder: seriesOrder.sortOrder,
    }))
    .filter((seriesOrder) => seriesOrder.seriesId.length > 0);

  if (seriesOrders.length === 0) {
    return Response.json({ error: "No series orders were provided." }, { status: 400 });
  }

  if (
    seriesOrders.some(
      (seriesOrder) =>
        !Number.isInteger(seriesOrder.sortOrder) ||
        (seriesOrder.sortOrder ?? -1) < 0,
    )
  ) {
    return Response.json(
      { error: "Sort order must be a non-negative integer." },
      { status: 400 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  let updatedCount = 0;

  for (const seriesOrder of seriesOrders) {
    const { error } = await supabase
      .from("display_group_series")
      .update({
        sort_order: seriesOrder.sortOrder,
        updated_at: now,
      })
      .eq("display_group_id", id)
      .eq("series_id", seriesOrder.seriesId);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    updatedCount += 1;
  }

  return Response.json({ ok: true, updatedCount });
}
