import { getAdminUser } from "@/lib/admin/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string; seriesId: string }>;
};

type UpdateLinkRequest = {
  sortOrder?: number;
};

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, seriesId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as UpdateLinkRequest;

  if (!Number.isInteger(body.sortOrder)) {
    return Response.json(
      { error: "Sort order must be an integer." },
      { status: 400 },
    );
  }

  const { error } = await createSupabaseAdminClient()
    .from("display_group_series")
    .update({
      sort_order: body.sortOrder,
      updated_at: new Date().toISOString(),
    })
    .eq("display_group_id", id)
    .eq("series_id", seriesId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await getAdminUser(request);

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, seriesId } = await context.params;
  const { error } = await createSupabaseAdminClient()
    .from("display_group_series")
    .delete()
    .eq("display_group_id", id)
    .eq("series_id", seriesId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
